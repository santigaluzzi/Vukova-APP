import { getRawDb } from "@/db";
import { defaultBranches } from "@/lib/branches";
import { getCurrentEmployee } from "@/lib/auth";
import { can, hasBranchAccess, scopeBranchIds } from "@/lib/permissions";
import { rejectUnsafeRequest } from "@/lib/auth-security";
import { isDate, isPeriod, shiftPeriod } from "@/lib/member-analytics";
import { plansFor } from "@/lib/renewal-plans";
import { effectiveBranchFilter } from "@/lib/branch-filter";
import { monthlySaleValue, normalizeSaleTaxes, salesMonthlyTotals, type PaymentTerminal, type SalesMonthlyTotals, type SalesPlanScenario } from "@/lib/sales-projection";

async function financeViewer() {
  const viewer = await getCurrentEmployee();
  if (!viewer) return { error: Response.json({ error: "Ingresá con tu cuenta." }, { status: 401 }) };
  if (!can(viewer.role, "finance.manage") || !scopeBranchIds(viewer.branchScope).length) return { error: Response.json({ error: "Tu cuenta no tiene acceso a la planificación financiera." }, { status: 403 }) };
  return { viewer };
}

const fields = `s.id,s.period,s.sale_on AS saleOn,s.plan_starts_on AS planStartsOn,s.branch_id AS branchId,s.plan_id AS planId,s.plan_label AS planLabel,
  s.service,s.currency,s.months,s.installments,s.method,s.quantity,s.amount_cents AS amountCents,s.surcharge_bps AS surchargeBps,
  s.sales_vat_ppm AS salesVatPpm,s.collection_fee_ppm AS collectionFeePpm,s.collection_fee_vat_ppm AS collectionFeeVatPpm,
  s.financing_fee_ppm AS financingFeePpm,s.financing_fee_vat_ppm AS financingFeeVatPpm,s.other_cost_ppm AS otherCostPpm,
  s.other_tax_ppm AS otherTaxPpm,s.iibb_retention_ppm AS iibbRetentionPpm,s.fixed_cost_cents AS fixedCostCents,
  s.terminal,s.card_installments AS cardInstallments,s.accreditation_days AS accreditationDays,s.provider,
  s.member_id AS memberId,s.origin,m.full_name AS memberName,s.updated_by AS updatedBy,s.updated_at AS updatedAt`;
const list = async (period: string, branchId: string) => getRawDb().prepare(`SELECT ${fields} FROM sales_plan_scenarios s LEFT JOIN members m ON m.id=s.member_id WHERE s.period>=? AND s.period<=? AND (?='all' OR s.branch_id=?)`).bind(shiftPeriod(period,-11),period,branchId,branchId).all<SalesPlanScenario>();
const range = (value: unknown, maximum: number) => value === null || Number.isInteger(value) && Number(value) >= 0 && Number(value) <= maximum;

export async function GET(request: Request) {
  const access = await financeViewer(); if (access.error) return access.error;
  const params = new URL(request.url).searchParams;
  const period = params.get("period");
  if (!isPeriod(period)) return Response.json({ error: "Elegí un mes válido." }, { status: 400 });
  const selected = effectiveBranchFilter(params.get("branch"), access.viewer!.branchScope);
  if ("error" in selected) return Response.json({ error: selected.error }, { status: selected.status });
  try {
    const result = await list(period, selected.branchId), rows = result.results;
    const currencies = [...new Set(rows.map(r=>r.currency))];
    const totals = Object.fromEntries(currencies.map(currency => [currency, { ...salesMonthlyTotals(rows.filter(r=>r.currency===currency),period), contractValueCents: monthlySaleValue(rows,period,currency),currency }])) as Record<string,SalesMonthlyTotals&{currency:string}>;
    if (!currencies.includes("ARS")) totals.ARS = { ...salesMonthlyTotals([],period), contractValueCents: 0,currency:"ARS" };
    return Response.json({ period, viewBranch: selected.branchId, rows: rows.filter(r => r.period === period).map(normalizeSaleTaxes), priorRows: rows.filter(r => r.period !== period).map(normalizeSaleTaxes), totals }, { headers: { "Cache-Control": "no-store" } });
  } catch { console.error("finance_sales_plan_read_failed"); return Response.json({ error: "No se pudo leer la proyección financiera." }, { status: 500 }); }
}

export async function POST(request: Request) {
  const rejected = rejectUnsafeRequest(request); if (rejected) return rejected;
  const access = await financeViewer(); if (access.error) return access.error;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return Response.json({ error: "Datos inválidos." }, { status: 400 }); }
  if (!body || typeof body !== "object" || !isPeriod(body.period)) return Response.json({ error: "Elegí un mes válido." }, { status: 400 });
  const db = getRawDb(), viewer = access.viewer!, now = new Date().toISOString();
  try {
    if (body.action === "delete") {
      if (typeof body.id !== "string" || body.id.length > 60) return Response.json({ error: "Elegí una fila válida." }, { status: 400 });
      const row = await db.prepare("SELECT origin,branch_id AS branchId FROM sales_plan_scenarios WHERE id=? AND period=?").bind(body.id,body.period).first<{ origin: string; branchId: string }>();
      if (!row || !hasBranchAccess(viewer.branchScope, row.branchId)) return Response.json({ error: "No se encontró la venta en tu sede." }, { status: 403 });
      if (row?.origin === "member_sale") return Response.json({ error: "Esta venta nació de un alta o cobro. Se conserva vinculada al pago registrado." }, { status: 409 });
      await db.batch([
        db.prepare("DELETE FROM sales_plan_scenarios WHERE id=? AND period=? AND (?='all' OR branch_id=?)").bind(body.id,body.period,viewer.branchScope,viewer.branchScope),
        db.prepare("INSERT INTO audit_logs (id,employee_id,action,entity_type,entity_id,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
          .bind(crypto.randomUUID(),viewer.id,"sales_plan.deleted","sales_plan_scenario",body.id,JSON.stringify({period:body.period}),now,now),
      ]);
      return Response.json({ ok: true });
    }
    const entries = Array.isArray(body.rows) ? body.rows : [body];
    if (!entries.length || entries.length > defaultBranches.length) return Response.json({ error: "Seleccioná al menos una sede." }, { status: 400 });
    const usedBranches = new Set<string>(), statements = [];
    for (const raw of entries) {
      if (!raw || typeof raw !== "object") return Response.json({ error: "Revisá las líneas seleccionadas." }, { status: 400 });
      const row = raw as Record<string, unknown>;
      const terminal = row.terminal as PaymentTerminal;
      const method = terminal === "cash" || terminal === "transfer" ? terminal : terminal === "nave" || terminal === "mercado_pago" ? "card" : null;
      if (!method || !isDate(row.saleOn) || row.saleOn.slice(0,7) !== body.period || typeof row.id !== "string" || row.id.length > 60 ||
          typeof row.branchId !== "string" || !defaultBranches.some(b => b.id === row.branchId) || usedBranches.has(row.branchId)) return Response.json({ error: "Revisá las sedes, la terminal y la fecha." }, { status: 400 });
      if (!hasBranchAccess(viewer.branchScope, row.branchId)) return Response.json({ error: "No podés guardar ventas fuera de tu sede." }, { status: 403 });
      const existing = await db.prepare("SELECT branch_id AS branchId FROM sales_plan_scenarios WHERE id=?").bind(row.id).first<{ branchId: string }>();
      if (existing && !hasBranchAccess(viewer.branchScope, existing.branchId)) return Response.json({ error: "No podés modificar ventas de otra sede." }, { status: 403 });
      usedBranches.add(row.branchId);
      const plan = typeof row.planId === "string" ? plansFor({branchId:row.branchId,service:"gym"}).concat(plansFor({branchId:row.branchId,service:"pool"})).find(p => p.id === row.planId) : undefined;
      const cardInstallmentsValid = method === "card" ? [1,3,6].includes(Number(row.cardInstallments)) : row.cardInstallments === null;
      if (!plan || !Number.isInteger(row.quantity) || Number(row.quantity) < 1 || Number(row.quantity) > 10000 ||
          !Number.isSafeInteger(row.amountCents) || Number(row.amountCents) < 1 || Number(row.amountCents) > 100000000000 ||
          !Number.isInteger(row.surchargeBps) || Number(row.surchargeBps) < 0 || Number(row.surchargeBps) > 10000 || !cardInstallmentsValid ||
          !range(row.collectionFeePpm,1000000) || !range(row.collectionFeeVatPpm,1000000) || !range(row.financingFeePpm,1000000) || !range(row.financingFeeVatPpm,1000000) ||
          !range(row.otherCostPpm,1000000) || !range(row.otherTaxPpm,1000000) || !range(row.iibbRetentionPpm,1000000) ||
          !range(row.fixedCostCents,100000000000) || !range(row.accreditationDays,180)) return Response.json({ error: "Revisá el plan, las cuotas, el precio y las comisiones. Pileta solo está disponible en Acassuso." }, { status: 400 });
      if (plan.currency !== "ARS" && method !== "cash") return Response.json({ error: "Los planes en USD solo admiten efectivo." }, { status: 400 });
      if (!Number.isSafeInteger(Number(row.amountCents) * (10000 + Number(row.surchargeBps)) * plan.installments * Number(row.quantity))) return Response.json({ error: "El importe total supera el máximo permitido." }, { status: 400 });
      const activeBranch = await db.prepare("SELECT id FROM branches WHERE id=? AND active=1").bind(row.branchId).first();
      if (!activeBranch) return Response.json({ error: "Una sede seleccionada no está disponible." }, { status: 400 });
      const fees = method === "card" ? row : { collectionFeePpm:0,collectionFeeVatPpm:0,financingFeePpm:0,financingFeeVatPpm:0,otherCostPpm:0,otherTaxPpm:0,iibbRetentionPpm:0,fixedCostCents:0 };
      statements.push(db.prepare(`INSERT INTO sales_plan_scenarios (id,period,sale_on,branch_id,plan_id,plan_label,service,currency,months,installments,method,terminal,card_installments,quantity,amount_cents,surcharge_bps,sales_vat_ppm,
        collection_fee_ppm,collection_fee_vat_ppm,financing_fee_ppm,financing_fee_vat_ppm,other_cost_ppm,other_tax_ppm,iibb_retention_ppm,fixed_cost_cents,accreditation_days,provider,member_id,origin,updated_by,updated_at)
        VALUES (${Array(27).fill("?").join(",")},NULL,'projection',?,?) ON CONFLICT(id) DO UPDATE SET period=excluded.period,sale_on=excluded.sale_on,branch_id=excluded.branch_id,plan_id=excluded.plan_id,plan_label=excluded.plan_label,
        service=excluded.service,currency=excluded.currency,months=excluded.months,installments=excluded.installments,method=excluded.method,terminal=excluded.terminal,card_installments=excluded.card_installments,quantity=excluded.quantity,amount_cents=excluded.amount_cents,surcharge_bps=excluded.surcharge_bps,
        sales_vat_ppm=excluded.sales_vat_ppm,collection_fee_ppm=excluded.collection_fee_ppm,collection_fee_vat_ppm=excluded.collection_fee_vat_ppm,financing_fee_ppm=excluded.financing_fee_ppm,
        financing_fee_vat_ppm=excluded.financing_fee_vat_ppm,other_cost_ppm=excluded.other_cost_ppm,other_tax_ppm=excluded.other_tax_ppm,iibb_retention_ppm=excluded.iibb_retention_ppm,
        fixed_cost_cents=excluded.fixed_cost_cents,accreditation_days=excluded.accreditation_days,provider=excluded.provider,updated_by=excluded.updated_by,updated_at=excluded.updated_at WHERE (?='all' OR sales_plan_scenarios.branch_id=?)`)
        .bind(row.id,body.period,row.saleOn,row.branchId,plan.id,plan.label,plan.service,plan.currency,plan.months,plan.installments,method,terminal,method === "card" ? row.cardInstallments : null,row.quantity,row.amountCents,row.surchargeBps,method === "cash" ? 0 : 210000,
          fees.collectionFeePpm,fees.collectionFeeVatPpm,fees.financingFeePpm,fees.financingFeeVatPpm,fees.otherCostPpm,fees.otherTaxPpm,fees.iibbRetentionPpm,fees.fixedCostCents,method === "card" ? row.accreditationDays : 0,method === "card" ? (terminal === "nave" ? "NAVE" : "Mercado Pago") : null,viewer.id,now,viewer.branchScope,viewer.branchScope));
      statements.push(db.prepare("INSERT INTO audit_logs (id,employee_id,action,entity_type,entity_id,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(crypto.randomUUID(),viewer.id,"sales_plan.saved","sales_plan_scenario",row.id,JSON.stringify({period:body.period,branchId:row.branchId,planId:plan.id,method,terminal,quantity:row.quantity}),now,now));
    }
    await db.batch(statements);
    return Response.json({ ok:true },{ headers:{"Cache-Control":"no-store"} });
  } catch { console.error("finance_sales_plan_save_failed"); return Response.json({ error: "No se pudo guardar el plan. Tus cambios siguen en pantalla." }, { status: 500 }); }
}
