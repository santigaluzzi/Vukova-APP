import { getRawDb } from "@/db";
import { sheetViewer } from "@/lib/sheet-views";
import { rejectUnsafeRequest } from "@/lib/auth-security";
import { isDate, isPeriod } from "@/lib/member-analytics";
import { plansFor } from "@/lib/renewal-plans";

export async function GET(request: Request) {
  const access = await sheetViewer("payments.manage", "members"); if (access.error) return access.error;
  const period = new URL(request.url).searchParams.get("period");
  if (!isPeriod(period)) return Response.json({ error: "Elegí un mes válido." }, { status: 400 });
  try {
    const rows = await getRawDb().prepare(`SELECT s.member_id AS memberId,s.period,s.due_on AS dueOn,s.plan_id AS planId,s.method,
      s.amount_cents AS amountCents,s.probability,s.card_cost_bps AS cardCostBps,s.included,s.updated_at AS updatedAt
      FROM renewal_scenarios s JOIN members m ON m.id=s.member_id LEFT JOIN sheet_rosters r ON r.member_id=m.id
      WHERE s.period=? AND (?='all' OR m.home_branch_id=?) AND (r.member_id IS NULL OR r.archived_at IS NULL)`)
      .bind(period, access.viewer!.branchScope, access.viewer!.branchScope).all();
    return Response.json({ scenarios: rows.results.map(r => ({ ...r, included: !!r.included })) }, { headers: { "Cache-Control": "no-store" } });
  } catch { console.error("renewal_scenarios_read_failed"); return Response.json({ error: "No se pudieron leer las proyecciones." }, { status: 500 }); }
}

export async function POST(request: Request) {
  const rejected = rejectUnsafeRequest(request); if (rejected) return rejected;
  const access = await sheetViewer("payments.manage", "members"); if (access.error) return access.error;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return Response.json({ error: "Datos inválidos." }, { status: 400 }); }
  if (!body || typeof body !== "object" || typeof body.memberId !== "string" || !isPeriod(body.period)) return Response.json({ error: "Elegí un socio y un mes válido." }, { status: 400 });
  try {
    const db = getRawDb(), viewer = access.viewer!;
    const member = await db.prepare(`SELECT m.id,m.service,m.home_branch_id AS branchId FROM members m LEFT JOIN sheet_rosters r ON r.member_id=m.id
      WHERE m.id=? AND (?='all' OR m.home_branch_id=?) AND (r.member_id IS NULL OR r.archived_at IS NULL)`).bind(body.memberId, viewer.branchScope, viewer.branchScope).first<{ id: string; branchId: string; service: string }>();
    if (!member) return Response.json({ error: "No se encontró la ficha en tu sede." }, { status: 404 });
    const now = new Date().toISOString(), id = `${body.memberId}:${body.period}`;
    const audit = db.prepare("INSERT INTO audit_logs (id,employee_id,action,entity_type,entity_id,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(),viewer.id,body.reset === true ? "renewal_scenario.reset" : "renewal_scenario.saved","member",member.id,JSON.stringify({period:body.period}),now,now);
    if (body.reset === true) {
      await db.batch([db.prepare("DELETE FROM renewal_scenarios WHERE id=?").bind(id), audit]);
      return Response.json({ ok: true });
    }
    const plan = plansFor(member).find(p => p.id === body.planId);
    if (!plan || typeof body.method !== "string" || !plan.methods.includes(body.method as "cash" | "transfer" | "card") || !isDate(body.dueOn) || body.dueOn.slice(0,7) !== body.period ||
        !Number.isSafeInteger(body.amountCents) || Number(body.amountCents) <= 0 || Number(body.amountCents) > 100000000000 ||
        !Number.isInteger(body.probability) || Number(body.probability) < 0 || Number(body.probability) > 100 || typeof body.included !== "boolean" ||
        (body.cardCostBps !== null && (!Number.isInteger(body.cardCostBps) || Number(body.cardCostBps) < 0 || Number(body.cardCostBps) > 10000))) {
      return Response.json({ error: "Revisá fecha, plan, importe y porcentajes. Pileta solo está disponible en Acassuso." }, { status: 400 });
    }
    await db.batch([db.prepare(`INSERT INTO renewal_scenarios (id,member_id,period,due_on,plan_id,method,amount_cents,probability,card_cost_bps,included,updated_by,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET due_on=excluded.due_on,plan_id=excluded.plan_id,method=excluded.method,
      amount_cents=excluded.amount_cents,probability=excluded.probability,card_cost_bps=excluded.card_cost_bps,included=excluded.included,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
      .bind(id,member.id,body.period,body.dueOn,plan.id,body.method,body.amountCents,body.probability,body.method === "card" ? body.cardCostBps : null,body.included ? 1 : 0,viewer.id,now), audit]);
    return Response.json({ ok: true });
  } catch { console.error("renewal_scenario_save_failed"); return Response.json({ error: "No se pudo guardar la proyección. Tus cambios siguen en pantalla." }, { status: 500 }); }
}
