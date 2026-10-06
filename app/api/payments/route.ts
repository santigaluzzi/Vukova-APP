import { getRawDb } from "@/db";
import { defaultBranches } from "@/lib/branch-catalog";
import { getCurrentEmployee } from "@/lib/auth";
import { canAny } from "@/lib/permissions";
import { rejectUnsafeRequest } from "@/lib/auth-security";
import { installment as parseInstallment, isDate, parseMoney, latestCycle } from "@/lib/member-analytics";
import type { SourceMonth } from "@/lib/sheet-data";
import { localDay, normalizeName } from "@/lib/sheet-data";
import { plansFor, type RenewalPlan } from "@/lib/renewal-plans";
import { monthlyPlans } from "@/lib/monthly-plans";
import { memberPaymentContext } from "@/lib/payment-context";
import type { PaymentTerminal } from "@/lib/sales-projection";
import { effectiveBranchFilter } from "@/lib/branch-filter";

const canRegister = (role: Parameters<typeof canAny>[0]) => canAny(role, ["payments.manage", "payments.register"]);
const terminals: PaymentTerminal[] = ["cash", "transfer", "nave", "mercado_pago"];
const isCard = (terminal: PaymentTerminal) => terminal === "nave" || terminal === "mercado_pago";
const methodFor = (terminal: PaymentTerminal) => terminal === "nave" || terminal === "mercado_pago" ? "card" : terminal;
const range = (value: unknown, max = 1000000) => value === null || Number.isInteger(value) && Number(value) >= 0 && Number(value) <= max;
const safeName = (value: unknown) => typeof value === "string" && value.trim().length >= 2 && value.trim().length <= 120;
const addDays = (date: string, count: number) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
};
const addMonths = (date: string, count: number) => {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + count, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
};

async function paymentViewer() {
  const viewer = await getCurrentEmployee();
  if (!viewer) return { error: Response.json({ error: "Ingresá con tu cuenta." }, { status: 401 }) };
  if (!canRegister(viewer.role)) return { error: Response.json({ error: "Tu cuenta no puede registrar cobros." }, { status: 403 }) };
  return { viewer };
}

export async function GET(request: Request) {
  const access = await paymentViewer();
  if (access.error) return access.error;
  const selected = effectiveBranchFilter(new URL(request.url).searchParams.get("branch"), access.viewer!.branchScope);
  if ("error" in selected) return Response.json({ error: selected.error }, { status: selected.status });
  const branchScope = selected.branchId;
  try {
    const db = getRawDb(), viewer = access.viewer!;
    const memberId = new URL(request.url).searchParams.get("memberId");
    const [memberRows, paymentRows, feeRows, contractRows] = await Promise.all([
      db.prepare(`SELECT m.id,m.full_name AS name,m.home_branch_id AS branchId,b.name AS branchName,coalesce(m.service,'gym') AS service,
          m.plan_name AS planName,m.status,r.history_json AS historyJson,
          coalesce((SELECT p.coverage_starts_on FROM payments p WHERE p.member_id=m.id AND p.coverage_starts_on IS NOT NULL ORDER BY p.created_at DESC LIMIT 1),m.plan_starts_on) AS planStartsOn
        FROM members m JOIN branches b ON b.id=m.home_branch_id LEFT JOIN sheet_rosters r ON r.member_id=m.id
        WHERE (?='all' OR m.home_branch_id=?) AND (r.member_id IS NULL OR r.archived_at IS NULL)
        ORDER BY m.full_name,m.service`).bind(branchScope, branchScope).all(),
      db.prepare(`SELECT p.id,p.member_id AS memberId,p.amount_cents AS amountCents,p.currency,p.method,p.terminal,p.card_installments AS cardInstallments,
          p.paid_on AS paidOn,p.status,p.sale_kind AS saleKind,p.installment_number AS installmentNumber,
          m.full_name AS memberName,b.name AS branchName,coalesce(p.plan_label,s.plan_label) AS planLabel
        FROM payments p JOIN members m ON m.id=p.member_id LEFT JOIN branches b ON b.id=m.home_branch_id
        LEFT JOIN sales_plan_scenarios s ON s.id=p.sales_plan_scenario_id
        WHERE (?='all' OR m.home_branch_id=?) AND (? IS NULL OR p.member_id=?) ORDER BY coalesce(p.paid_on,p.created_at) DESC LIMIT 100`)
        .bind(branchScope,branchScope,memberId,memberId).all(),
      db.prepare(`SELECT terminal,card_installments AS cardInstallments,collection_fee_ppm AS collectionFeePpm,
          collection_fee_vat_ppm AS collectionFeeVatPpm,financing_fee_ppm AS financingFeePpm,
          financing_fee_vat_ppm AS financingFeeVatPpm,other_cost_ppm AS otherCostPpm,other_tax_ppm AS otherTaxPpm,
          iibb_retention_ppm AS iibbRetentionPpm,fixed_cost_cents AS fixedCostCents,accreditation_days AS accreditationDays
        FROM sales_plan_scenarios WHERE method='card' AND terminal IN ('nave','mercado_pago') AND (?='all' OR branch_id=?)
        ORDER BY updated_at DESC`).bind(branchScope, branchScope).all(),
      db.prepare(`SELECT s.id,s.member_id AS memberId,s.plan_id AS planId,s.plan_label AS planLabel,coalesce(s.plan_starts_on,s.sale_on) AS saleOn,
          s.installments,s.amount_cents AS amountCents,s.surcharge_bps AS surchargeBps,s.method,
          (SELECT max(coalesce(p.installment_number,CASE WHEN p.sale_kind IN ('new_member','renewal') THEN 1 END))
            FROM payments p WHERE p.sales_plan_scenario_id=s.id AND p.status='paid') AS paidThrough,
          (SELECT json_group_array(coalesce(p.installment_number,1)) FROM payments p WHERE p.sales_plan_scenario_id=s.id AND p.status='paid') AS paidNumbers
        FROM sales_plan_scenarios s WHERE s.origin='member_sale' AND s.member_id IS NOT NULL AND (?='all' OR s.branch_id=?)
        ORDER BY s.sale_on DESC,s.updated_at DESC`).bind(branchScope,branchScope).all(),
    ]);
    const defaults: Record<string, Record<string, unknown>> = {};
    for (const row of feeRows.results as Array<Record<string, unknown>>) {
      const key = `${row.terminal}:${row.cardInstallments}`;
      if (!(key in defaults)) defaults[key] = row;
    }
    return Response.json({
      members: memberRows.results.map(row => ({...row,historyJson:undefined,planStartsOn:row.planStartsOn ?? (row.historyJson ? latestCycle(JSON.parse(String(row.historyJson)),localDay().slice(0,7))?.start : null) ?? null})),
      payments: paymentRows.results,
      branches: defaultBranches.filter(branch => viewer.branchScope === "all" || branch.id === viewer.branchScope),
      branchScope: viewer.branchScope,
      viewBranch: branchScope,
      feeDefaults: defaults,
      contracts: contractRows.results.filter((row,index,rows)=>rows.findIndex(candidate=>candidate.memberId===row.memberId)===index).map(row => {
        const paid=JSON.parse(String(row.paidNumbers)) as number[];
        const nextInstallment=Array.from({length:Number(row.installments)},(_,index)=>index+1).find(number=>!paid.includes(number)) ?? null;
        return {...row,paidNumbers:undefined,nextInstallment};
      }),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("payments_read_failed");
    return Response.json({ error: "No se pudieron cargar los cobros." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const rejected = rejectUnsafeRequest(request);
  if (rejected) return rejected;
  const access = await paymentViewer();
  if (access.error) return access.error;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return Response.json({ error: "Datos inválidos." }, { status: 400 }); }
  if (!body || typeof body !== "object" || !["new_member", "renewal", "installment"].includes(String(body.action))) return Response.json({ error: "Elegí un alta, una cuota o una renovación." }, { status: 400 });

  const viewer = access.viewer!, db = getRawDb();
  const requestId = body.requestId;
  if (typeof requestId !== "string" || requestId.length < 16 || requestId.length > 80) return Response.json({ error: "La operación no tiene un identificador válido. Volvé a intentarlo." }, { status: 400 });
  const priorPayment = await db.prepare(`SELECT p.id,p.member_id AS memberId,p.sales_plan_scenario_id AS salesPlanScenarioId
    FROM payments p WHERE p.request_id=?`).bind(requestId).first<{ id: string; memberId: string; salesPlanScenarioId: string | null }>();
  if (priorPayment) return Response.json({ ok: true, duplicate: true, paymentId: priorPayment.id, memberId: priorPayment.memberId, salesPlanScenarioId: priorPayment.salesPlanScenarioId });

  if (typeof body.planId !== "string" || !isDate(body.saleOn) || body.saleOn > localDay() || typeof body.terminal !== "string" || !terminals.includes(body.terminal as PaymentTerminal) ||
      !Number.isSafeInteger(body.amountCents) || Number(body.amountCents) < 1 || Number(body.amountCents) > 100000000000 ||
      !Number.isInteger(body.surchargeBps) || Number(body.surchargeBps) < 0 || Number(body.surchargeBps) > 10000) {
    return Response.json({ error: "Revisá el plan, la fecha, el medio de pago y el importe." }, { status: 400 });
  }
  const terminal = body.terminal as PaymentTerminal, method = methodFor(terminal), card = isCard(terminal);
  if (card ? ![1, 3, 6].includes(Number(body.cardInstallments)) : body.cardInstallments !== null) return Response.json({ error: "Elegí 1, 3 o 6 cuotas para la tarjeta." }, { status: 400 });
  if (card && !body.fees || body.fees !== undefined && (!body.fees || typeof body.fees !== "object" || Array.isArray(body.fees))) return Response.json({ error: "Revisá las comisiones de la tarjeta." }, { status: 400 });
  const fees = (body.fees ?? {}) as Record<string, unknown>;
  if (card && ["collectionFeePpm", "collectionFeeVatPpm", "financingFeePpm", "financingFeeVatPpm", "otherCostPpm", "otherTaxPpm", "iibbRetentionPpm"].some(key => !(key in fees) || !range(fees[key])) ||
      card && (!("fixedCostCents" in fees) || !range(fees.fixedCostCents, 100000000000)) || card && (!Number.isInteger(fees.accreditationDays) || Number(fees.accreditationDays) < 0 || Number(fees.accreditationDays) > 180)) {
    return Response.json({ error: "Completá las comisiones de la terminal o indicá 0 cuando no correspondan." }, { status: 400 });
  }

  try {
    let member: { id: string; name: string; branchId: string; service: string } | undefined;
    let newMember: { id: string; name: string; branchId: string; service: string; email: string | null; phone: string | null } | undefined;
    if (body.action === "new_member") {
      const info = body.newMember as Record<string, unknown> | null;
      if (!info || typeof info.branchId !== "string" || !defaultBranches.some(branch => branch.id === info.branchId) || !["gym", "pool"].includes(String(info.service)) || !safeName(info.name)) {
        return Response.json({ error: "Completá el nombre, la sede y el servicio del nuevo socio." }, { status: 400 });
      }
      if (viewer.branchScope !== "all" && info.branchId !== viewer.branchScope) return Response.json({ error: "No podés registrar socios fuera de tu sede." }, { status: 403 });
      const branch = await db.prepare("SELECT id FROM branches WHERE id=? AND active=1").bind(info.branchId).first();
      if (!branch) return Response.json({ error: "La sede elegida no está disponible." }, { status: 400 });
      const existing = await db.prepare(`SELECT m.full_name AS name FROM members m LEFT JOIN sheet_rosters r ON r.member_id=m.id
        WHERE m.home_branch_id=? AND coalesce(m.service,'gym')=? AND (r.member_id IS NULL OR r.archived_at IS NULL)`).bind(info.branchId, info.service).all<{ name: string }>();
      const normalized = normalizeName(info.name);
      if (existing.results.some(row => normalizeName(row.name) === normalized)) return Response.json({ error: "Ya existe un socio con ese nombre en la sede. Buscalo en Renovación para evitar duplicar su ficha." }, { status: 409 });
      const email = typeof info.email === "string" && info.email.trim() ? info.email.trim() : null;
      const phone = typeof info.phone === "string" && info.phone.trim() ? info.phone.trim() : null;
      if (email && (email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) || phone && phone.length > 40) return Response.json({ error: "Revisá el correo o el teléfono." }, { status: 400 });
      newMember = { id: crypto.randomUUID(), name: String(info.name).trim(), branchId: info.branchId, service: String(info.service), email, phone };
      member = newMember;
    } else {
      if (typeof body.memberId !== "string") return Response.json({ error: "Seleccioná el socio que renueva." }, { status: 400 });
      const row = await db.prepare(`SELECT m.id,m.full_name AS name,m.home_branch_id AS branchId,coalesce(m.service,'gym') AS service
        FROM members m LEFT JOIN sheet_rosters r ON r.member_id=m.id
        WHERE m.id=? AND (?='all' OR m.home_branch_id=?) AND (r.member_id IS NULL OR r.archived_at IS NULL)`)
        .bind(body.memberId, viewer.branchScope, viewer.branchScope).first<{ id: string; name: string; branchId: string; service: string }>();
      if (!row) return Response.json({ error: "No se encontró ese socio en tu sede." }, { status: 404 });
      member = row;
    }

    const activeBranch = await db.prepare("SELECT id FROM branches WHERE id=? AND active=1").bind(member!.branchId).first();
    if (!activeBranch) return Response.json({ error: "La sede del socio no está disponible." }, { status: 400 });
    const context = newMember ? null : await memberPaymentContext(member!,body.saleOn);
    const quote = body.action === "installment" ? context?.installment : null;
    if (body.action === "installment" && quote && (body.planId !== quote.planId || Number(body.installmentNumber) !== quote.number || Number(body.amountCents) !== quote.amountCents || Number(body.surchargeBps) !== quote.surchargeBps)) return Response.json({error:"La cuota pendiente o su importe cambió. Actualizá la ficha antes de cobrar."},{status:409});
    if (body.action === "installment" && !quote && !body.planStartsOn) return Response.json({error:context?.installmentIssue??"No hay una cuota pendiente identificada."},{status:409});
    const plan: RenewalPlan | undefined = quote ? {id:quote.planId,label:quote.label,service:member!.service as "gym"|"pool",branches:"all",months:quote.months,installments:quote.installments,amountCents:quote.amountCents,currency:quote.currency,methods:["cash","transfer"],surcharge:quote.surchargeBps/100} : (body.action === "installment" ? plansFor(member!) : await monthlyPlans(body.saleOn.slice(0,7),member!.branchId,member!.service)).find(item => item.id === body.planId);
    let membershipStart = body.saleOn;
    if (body.action === "renewal" && context) {
      const choice = body.renewalChoice ?? "automatic";
      if (!["automatic","continued","restarted"].includes(String(choice))) return Response.json({error:"Elegí cómo continúa el plan."},{status:400});
      if (choice === "continued") {
        const previous = context.renewal.previousEndsOn ?? body.previousEndsOn;
        if (!isDate(previous) || (!context.renewal.previousEndsOn && previous > body.saleOn)) return Response.json({error:"Confirmá el vencimiento anterior para conservar la continuidad."},{status:400});
        membershipStart = previous;
      } else if (choice === "restarted") membershipStart = body.saleOn;
      else {
        if(context.renewal.requiresConfirmation && body.renewalConfirmed !== true) return Response.json({error:"Confirmá el inicio propuesto: las asistencias o el vencimiento anterior no tienen datos suficientes."},{status:400});
        membershipStart=context.renewal.startsOn;
      }
    }
    if (!plan || !plan.methods.includes(method as "cash" | "transfer" | "card") || plan.currency !== "ARS" && method !== "cash") {
      return Response.json({ error: "Ese plan no está disponible para el servicio, la sede o el medio de pago seleccionado." }, { status: 400 });
    }
    const amountCents = Number(body.amountCents), surchargeBps = Number(body.surchargeBps), installments = card ? Number(body.cardInstallments) : null;
    if (body.action !== "installment" && (amountCents !== plan.amountCents || surchargeBps !== (method === "transfer" ? Math.round(plan.surcharge * 100) : 0))) return Response.json({error:"El precio del catálogo del mes cambió. Actualizá los datos del cobro."},{status:409});
    if (body.action !== "installment" && (method === "cash" || card) && surchargeBps !== 0) return Response.json({ error: "Efectivo y tarjeta no llevan recargo en este cálculo." }, { status: 400 });
    const installmentGross = Math.round(amountCents * (10000 + surchargeBps) / 10000);
    const contractCents = installmentGross * plan.installments;
    const receivedCents = card ? contractCents : installmentGross;
    if (!Number.isSafeInteger(contractCents) || !Number.isSafeInteger(receivedCents)) return Response.json({ error: "El importe total supera el máximo permitido." }, { status: 400 });

    const id = crypto.randomUUID(), paymentId = crypto.randomUUID(), now = new Date().toISOString(), period = body.saleOn.slice(0, 7);
    if (body.action === "installment") {
      const number=Number(body.installmentNumber);
      if (card || plan.installments<2 || !Number.isInteger(number) || number<1 || number>plan.installments) return Response.json({error:"Elegí una cuota válida de un plan con pagos mensuales. Las tarjetas se acreditan completas."},{status:400});
      const contract=await db.prepare(`SELECT id,installments,method,coalesce(plan_starts_on,sale_on) AS saleOn FROM sales_plan_scenarios
        WHERE member_id=? AND plan_id=? AND origin='member_sale' AND method IN ('cash','transfer') AND sale_on<=? AND (? IS NULL OR id=?)
        ORDER BY sale_on DESC,updated_at DESC LIMIT 1`).bind(member!.id,plan.id,body.saleOn,quote?.contractId??null,quote?.contractId??null).first<{id:string;installments:number;method:string;saleOn:string}>();
      const roster=await db.prepare("SELECT history_json AS historyJson FROM sheet_rosters WHERE member_id=? AND archived_at IS NULL").bind(member!.id).first<{historyJson:string}>();
      if (!contract && !roster) return Response.json({error:"No hay un plan vigente registrado para cobrar una cuota. Elegí Renovación de plan nuevo."},{status:400});
      const history = roster ? JSON.parse(roster.historyJson) as SourceMonth[] : [];
      const inferredCycle = latestCycle(history,period);
      const coverageStartsOn = quote?.startsOn ?? contract?.saleOn ?? body.planStartsOn ?? (inferredCycle?.months === plan.months ? inferredCycle.start : null);
      if (!isDate(coverageStartsOn) || (!contract && coverageStartsOn > body.saleOn)) return Response.json({error:"Confirmá la fecha de inicio del plan vigente para calcular las cuotas y su vencimiento."},{status:400});
      if (contract && (number<=1 || number>contract.installments)) return Response.json({error:"La primera cuota ya se cobró con la venta del plan o el número elegido excede el contrato."},{status:400});
      if (roster) {
        const history=JSON.parse(roster.historyJson) as Array<{period:string;amount:string;installment:string}>;
        const source=history.find(h=>h.period===period);
        if (parseInstallment(source?.installment??"")?.index===number && (parseMoney(source?.amount??"")??0)>0)
          return Response.json({error:"Esta cuota ya figura pagada en la planilla del mes."},{status:409});
      }
      if (contract) {
        const existing=await db.prepare(`SELECT id FROM payments WHERE sales_plan_scenario_id=? AND status='paid'
          AND (installment_number=? OR (?=1 AND installment_number IS NULL AND sale_kind IN ('new_member','renewal'))) LIMIT 1`).bind(contract.id,number,number).first();
        if (existing) return Response.json({error:"Esta cuota ya figura cobrada en la aplicación."},{status:409});
      } else if (roster) {
        const existing=await db.prepare(`SELECT id FROM payments WHERE member_id=? AND sale_kind='installment' AND plan_id=? AND installment_number=?
          AND (coverage_starts_on=? OR (coverage_starts_on IS NULL AND substr(paid_on,1,7)=?)) AND status='paid' LIMIT 1`).bind(member!.id,plan.id,number,coverageStartsOn,period).first();
        if (existing) return Response.json({error:"Esta cuota ya figura cobrada en la aplicación este mes."},{status:409});
      }
      const vatCents=method==="cash"?0:Math.round(installmentGross*210000/1000000);
      await db.batch([
        db.prepare(`INSERT INTO payments (id,member_id,amount_cents,currency,method,terminal,card_installments,sales_plan_scenario_id,request_id,
          plan_id,plan_label,installment_number,gross_amount_cents,costs_cents,net_amount_cents,due_on,paid_on,accredited_on,status,
          created_by_employee_id,created_at,updated_at,sale_kind,sale_branch_id,coverage_starts_on,coverage_months,coverage_installments)
          VALUES (?,?,?,?,?,?,NULL,?,?,?,?,?,?,0,?,?,?,?,'paid',?,?,?,?,?,?,?,?)`)
          .bind(paymentId,member!.id,installmentGross,plan.currency,method,terminal,contract?.id??null,requestId,plan.id,plan.label,number,
            installmentGross,installmentGross-vatCents,addMonths(coverageStartsOn,number-1),body.saleOn,body.saleOn,viewer.id,now,now,"installment",member!.branchId,coverageStartsOn,plan.months,plan.installments),
        db.prepare("INSERT INTO audit_logs (id,employee_id,action,entity_type,entity_id,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
          .bind(crypto.randomUUID(),viewer.id,"installment.paid","payment",paymentId,JSON.stringify({memberId:member!.id,branchId:member!.branchId,planId:plan.id,installmentNumber:number,contractId:contract?.id??null}),now,now),
      ]);
      return Response.json({ok:true,paymentId,member:{id:member!.id,name:member!.name},sale:{planLabel:plan.label,collectedCents:installmentGross,installmentNumber:number,linkedProjection:false}},{status:201});
    }
    const accreditationDays = card ? Number(fees.accreditationDays) : 0, accreditedOn = addDays(body.saleOn, accreditationDays);
    const vatPpm = method === "cash" ? 0 : 210000;
    const normalizedFees = card ? fees : { collectionFeePpm: 0, collectionFeeVatPpm: 0, financingFeePpm: 0, financingFeeVatPpm: 0, otherCostPpm: 0, otherTaxPpm: 0, iibbRetentionPpm: 0, fixedCostCents: 0 };
    const costKeys = ["collectionFeePpm", "collectionFeeVatPpm", "financingFeePpm", "financingFeeVatPpm", "otherCostPpm", "otherTaxPpm", "iibbRetentionPpm"] as const;
    const costsComplete = !card || [...costKeys, "fixedCostCents"].every(key => Number.isInteger(normalizedFees[key]));
    const transactionCosts = costsComplete ? costKeys.reduce((sum, key) => sum + Math.round(receivedCents * Number(normalizedFees[key] ?? 0) / 1000000), Number(normalizedFees.fixedCostCents ?? 0)) : null;
    const vatCents = Math.round(receivedCents * vatPpm / 1000000);
    const netCents = transactionCosts === null ? null : receivedCents - vatCents - transactionCosts;
    const match = await db.prepare(`SELECT id FROM sales_plan_scenarios WHERE period=? AND sale_on=? AND branch_id=? AND plan_id=? AND method=?
      AND coalesce(terminal,'')=? AND coalesce(card_installments,0)=? AND quantity=1 AND amount_cents=? AND surcharge_bps=?
      AND months=? AND installments=? AND service=? AND currency=? AND plan_label=? AND member_id IS NULL AND origin='projection' LIMIT 2`).bind(period, body.saleOn, member!.branchId, plan.id, method, terminal, installments ?? 0, amountCents, surchargeBps,plan.months,plan.installments,plan.service,plan.currency,plan.label).all<{ id: string }>();
    const matchingScenarioId = match.results.length === 1 ? match.results[0].id : null;
    const scenarioId = matchingScenarioId ?? id;
    const scenarioArgs = [id, period, body.saleOn, member!.branchId, plan.id, plan.label, plan.service, plan.currency, plan.months, plan.installments,
      method, terminal, installments, 1, amountCents, surchargeBps, vatPpm, normalizedFees.collectionFeePpm, normalizedFees.collectionFeeVatPpm,
      normalizedFees.financingFeePpm, normalizedFees.financingFeeVatPpm, normalizedFees.otherCostPpm, normalizedFees.otherTaxPpm,
      normalizedFees.iibbRetentionPpm, normalizedFees.fixedCostCents, accreditationDays, card ? terminal === "nave" ? "NAVE" : "Mercado Pago" : null,
      member!.id, viewer.id, now];

    const statements = [];
    if (newMember) statements.push(db.prepare(`INSERT INTO members (id,full_name,email,phone,home_branch_id,status,service,plan_name,plan_starts_on,plan_ends_on,created_at,updated_at)
      VALUES (?,?,?,?,?,'active',?,?,?,?,?,?)`).bind(newMember.id, newMember.name, newMember.email, newMember.phone, newMember.branchId, newMember.service, plan.label, membershipStart, addMonths(membershipStart, plan.months), now, now));
    if (matchingScenarioId) {
      statements.push(db.prepare(`UPDATE sales_plan_scenarios SET member_id=?,origin='member_sale',updated_by=?,updated_at=? WHERE id=? AND member_id IS NULL AND origin='projection'`)
        .bind(member!.id, viewer.id, now, matchingScenarioId));
    } else {
      statements.push(db.prepare(`INSERT INTO sales_plan_scenarios (id,period,sale_on,branch_id,plan_id,plan_label,service,currency,months,installments,method,terminal,card_installments,
        quantity,amount_cents,surcharge_bps,sales_vat_ppm,collection_fee_ppm,collection_fee_vat_ppm,financing_fee_ppm,financing_fee_vat_ppm,other_cost_ppm,other_tax_ppm,
        iibb_retention_ppm,fixed_cost_cents,accreditation_days,provider,member_id,origin,updated_by,updated_at)
        VALUES (${Array(28).fill("?").join(",")},'member_sale',?,?)`).bind(...scenarioArgs));
    }
    statements.push(db.prepare("UPDATE sales_plan_scenarios SET plan_starts_on=? WHERE id=?").bind(membershipStart,scenarioId));
    statements.push(db.prepare(`INSERT INTO payments (id,member_id,amount_cents,currency,method,terminal,card_installments,sales_plan_scenario_id,request_id,
      plan_id,plan_label,installment_number,gross_amount_cents,costs_cents,net_amount_cents,due_on,paid_on,accredited_on,status,created_by_employee_id,created_at,updated_at,sale_kind,sale_branch_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'paid',?,?,?,?,?)`).bind(paymentId, member!.id, receivedCents, plan.currency, method, terminal, installments, scenarioId,
        requestId,plan.id,plan.label,1, receivedCents, transactionCosts, netCents, membershipStart, body.saleOn, accreditedOn, viewer.id, now, now, body.action, member!.branchId));
    statements.push(db.prepare(`UPDATE members SET status='active',service=?,plan_name=?,plan_starts_on=?,plan_ends_on=?,updated_at=? WHERE id=?`)
      .bind(plan.service, plan.label, membershipStart, addMonths(membershipStart, plan.months), now, member!.id));
    statements.push(db.prepare(`INSERT INTO audit_logs (id,employee_id,action,entity_type,entity_id,metadata_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), viewer.id, newMember ? "member.created_with_payment" : "renewal.paid",
        "payment", paymentId, JSON.stringify({ memberId: member!.id, branchId: member!.branchId, planId: plan.id, terminal, cardInstallments: installments, scenarioId, membershipStart, renewalChoice:body.renewalChoice??"automatic", renewalEvidence:context?.renewal??null, linkedProjection: !!matchingScenarioId }), now, now));
    if (body.action === "renewal") statements.push(db.prepare("INSERT INTO member_month_events (id,member_id,period,kind,observed_at) VALUES (?,?,?,'renewal',?) ON CONFLICT(id) DO NOTHING")
      .bind(`${member!.id}:${period}:renewal`,member!.id,period,now));

    await db.batch(statements);
    return Response.json({ ok: true, paymentId, member: { id: member!.id, name: member!.name, branchId: member!.branchId, service: member!.service },
      sale: { id: scenarioId, planId: plan.id, planLabel: plan.label, saleOn: body.saleOn, startsOn:membershipStart, grossCents: contractCents, collectedCents: receivedCents, linkedProjection: !!matchingScenarioId } }, { status: 201 });
  } catch {
    const retry = await db.prepare(`SELECT p.id,p.member_id AS memberId,p.sales_plan_scenario_id AS salesPlanScenarioId FROM payments p WHERE p.request_id=?`)
      .bind(requestId).first<{ id: string; memberId: string; salesPlanScenarioId: string | null }>().catch(() => null);
    if (retry) return Response.json({ ok: true, duplicate: true, paymentId: retry.id, memberId: retry.memberId, salesPlanScenarioId: retry.salesPlanScenarioId });
    console.error("payment_register_failed");
    return Response.json({ error: "No se pudo registrar el cobro. No vuelvas a cargarlo hasta actualizar la pantalla." }, { status: 500 });
  }
}
