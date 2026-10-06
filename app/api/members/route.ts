import { getRawDb } from "@/db";
import { sheetViewer } from "@/lib/sheet-views";
import { ACASSUSO_BRANCH, localDay } from "@/lib/sheet-data";
import { ROSTER_SOURCES } from "@/lib/roster-sources";
import { monthState, installment, parseMoney, paymentDay, dateAtDay, type RosterMember } from "@/lib/member-analytics";
import { can, canAny } from "@/lib/permissions";
import { effectiveBranchFilter } from "@/lib/branch-filter";
import { planMonth, planPeriods, addPlanMonths, type AppPlan } from "@/lib/member-plan-calendar";

export async function GET(request: Request) {
  const access = await sheetViewer("members.read", "members"); if (access.error) return access.error;
  const selected = effectiveBranchFilter(new URL(request.url).searchParams.get("branch"), access.viewer!.branchScope);
  if ("error" in selected) return Response.json({ error: selected.error }, { status: selected.status });
  const branchScope = selected.branchId;
  const allowedBranchesJson = JSON.stringify(selected.branchIds);
  try {
    const db = getRawDb();
    const result = await db.prepare(`SELECT m.id, m.full_name AS name, m.service, m.status, m.plan_name AS plan,
      r.source_row AS sourceRow, r.source_sheet_id AS sheetId, r.source_state AS sourceState, r.normalized_name AS normalizedName,
      m.home_branch_id AS branchId,b.name AS branchName,r.source_spreadsheet_id AS spreadsheetId,r.missing_since AS missingSince,r.source_details_json AS detailsJson,
      r.review_json AS reviewJson, r.history_json AS historyJson, r.imported_at AS importedAt
      FROM members m JOIN sheet_rosters r ON r.member_id=m.id JOIN branches b ON b.id=m.home_branch_id
      WHERE m.home_branch_id IN (SELECT value FROM json_each(?)) AND r.archived_at IS NULL ORDER BY m.full_name, m.service`).bind(allowedBranchesJson).all<Omit<RosterMember,"details"|"history"|"review"> & {normalizedName:string;detailsJson:string;historyJson:string;reviewJson:string}>();
    const manual = await db.prepare(`SELECT m.id,m.full_name AS name,m.service,m.status,m.plan_name AS plan,m.plan_starts_on AS planStartsOn,
        m.created_at AS createdAt,m.email,m.phone,m.home_branch_id AS branchId,b.name AS branchName
      FROM members m JOIN branches b ON b.id=m.home_branch_id LEFT JOIN sheet_rosters r ON r.member_id=m.id
      WHERE m.home_branch_id IN (SELECT value FROM json_each(?)) AND r.member_id IS NULL ORDER BY m.full_name,m.service`)
      .bind(allowedBranchesJson).all<{id:string;name:string;service:string|null;status:string;plan:string|null;planStartsOn:string|null;createdAt:string;email:string|null;phone:string|null;branchId:string;branchName:string}>();
    const frequencies = new Map<string, number>();
    for (const r of result.results) frequencies.set(String(r.normalizedName), (frequencies.get(String(r.normalizedName)) ?? 0) + 1);
    const members: RosterMember[] = result.results.map(r => ({ ...r, details:JSON.parse(String(r.detailsJson)), history: JSON.parse(String(r.historyJson)), review: [...JSON.parse(String(r.reviewJson)), ...(r.missingSince ? ["La ficha ya no aparece con este nombre en la planilla. Revisar si se quitó o cambió el nombre; se conserva su historial."] : []), ...(Number(frequencies.get(String(r.normalizedName))) > 1 ? ["Hay otro registro con este nombre; conservar separados hasta confirmar identidad."] : [])], historyJson: undefined, reviewJson: undefined, detailsJson:undefined }));
    members.push(...manual.results.map(r => ({
      id:r.id,name:r.name,service:r.service ?? "gym",status:r.status,plan:r.plan,branchId:r.branchId,branchName:r.branchName,
      history:r.planStartsOn ? [{period:r.planStartsOn.slice(0,7),amount:"",state:"N",date:r.planStartsOn.slice(8,10),plan:r.plan ?? "",installment:""}] : [],
      importedAt:r.planStartsOn ?? r.createdAt,missingSince:null,sourceState:"N",review:[],sourceRow:0,sheetId:0,spreadsheetId:"",
      details:Object.fromEntries([["Correo",r.email ?? ""],["Teléfono",r.phone ?? ""]].filter(([,value])=>value)) as Record<string,string>,
    })));
    const appPayments = await db.prepare(`SELECT p.id,p.member_id AS memberId,p.paid_on AS paidOn,p.sale_kind AS saleKind,
      coalesce(p.plan_label,s.plan_label,m.plan_name,'Plan') AS planLabel,p.installment_number AS installmentNumber,
      p.amount_cents AS amountCents,p.currency,p.method,p.plan_id AS planId,p.sales_plan_scenario_id AS contractId,
      p.coverage_starts_on AS coverageStartsOn,p.coverage_months AS coverageMonths,p.coverage_installments AS coverageInstallments,p.created_at AS createdAt
      FROM payments p JOIN members m ON m.id=p.member_id
      LEFT JOIN sales_plan_scenarios s ON s.id=p.sales_plan_scenario_id
      WHERE p.status='paid' AND p.paid_on IS NOT NULL AND m.home_branch_id IN (SELECT value FROM json_each(?))
      ORDER BY p.paid_on DESC,p.created_at DESC`).bind(allowedBranchesJson).all<{id:string;memberId:string;paidOn:string;saleKind:string;planLabel:string;installmentNumber:number|null;amountCents:number;currency:string;contractId:string|null;method:string;planId:string;coverageStartsOn:string|null;coverageMonths:number|null;coverageInstallments:number|null;createdAt:string}>();
    const paymentsByMember = new Map<string, typeof appPayments.results>();
    for (const payment of appPayments.results) paymentsByMember.set(payment.memberId, [...(paymentsByMember.get(payment.memberId) ?? []), payment]);
    for (const member of members) member.appPayments = paymentsByMember.get(member.id) ?? [];
    const appPlans = await db.prepare(`SELECT s.id,s.member_id AS memberId,s.plan_id AS planId,s.plan_label AS label,
      coalesce(s.plan_starts_on,s.sale_on) AS startsOn,s.months,s.installments,s.method,s.currency,s.amount_cents AS amountCents,s.surcharge_bps AS surchargeBps,
      p.sale_kind AS saleKind,p.created_at AS createdAt FROM sales_plan_scenarios s
      JOIN members m ON m.id=s.member_id JOIN payments p ON p.sales_plan_scenario_id=s.id
      WHERE s.origin='member_sale' AND p.status='paid' AND p.sale_kind IN ('new_member','renewal')
      AND m.home_branch_id IN (SELECT value FROM json_each(?))`).bind(allowedBranchesJson).all<AppPlan & {memberId:string}>();
    const plansByMember = new Map<string, AppPlan[]>();
    for (const plan of appPlans.results) plansByMember.set(plan.memberId,[...(plansByMember.get(plan.memberId) ?? []),plan]);
    for (const payment of appPayments.results) {
      if (payment.contractId || !payment.coverageStartsOn || !payment.coverageMonths || !payment.coverageInstallments) continue;
      const id=`legacy:${payment.memberId}:${payment.planId}:${payment.coverageStartsOn}`;
      payment.contractId=id;
      const plans=plansByMember.get(payment.memberId) ?? [];
      if (plans.some(plan => plan.id === id)) continue;
      const member=members.find(member => member.id === payment.memberId);
      const settledInstallments=member?.history.flatMap(h => {
        const part=installment(h.installment),day=paymentDay(h.date,h.period);
        if (!part || part.total !== payment.coverageInstallments || !day || !['A','N'].includes(h.state) || (parseMoney(h.amount) ?? 0) <= 0 || addPlanMonths(payment.coverageStartsOn!,part.index-1).slice(0,7) !== h.period) return [];
        return [{number:part.index,paidOn:dateAtDay(h.period,day)}];
      });
      plans.push({id,planId:payment.planId,label:payment.planLabel,startsOn:payment.coverageStartsOn,months:payment.coverageMonths,
        installments:payment.coverageInstallments,method:payment.method,currency:payment.currency,amountCents:payment.amountCents,surchargeBps:0,
        saleKind:'installment',createdAt:payment.createdAt,settledInstallments});
      plansByMember.set(payment.memberId,plans);
    }
    for (const member of members) member.appPlans = plansByMember.get(member.id) ?? [];
    const visitors = selected.branchIds.includes(ACASSUSO_BRANCH) ? await db.prepare(`SELECT v.normalized_name AS normalizedName,v.source_name AS name,v.status,v.declared_at AS declaredAt
      FROM sheet_active_visitors v WHERE NOT EXISTS(SELECT 1 FROM sheet_rosters r WHERE r.normalized_name=v.normalized_name AND r.service='gym' AND r.archived_at IS NULL)
      AND NOT EXISTS(SELECT 1 FROM sheet_name_links l WHERE l.normalized_name=v.normalized_name)
      AND NOT EXISTS(SELECT 1 FROM sheet_member_aliases a WHERE a.normalized_name=v.normalized_name) ORDER BY v.source_name`).all() : {results:[]};
    const receipts = await db.prepare("SELECT id,synced_at AS syncedAt,record_count AS records,review_json AS reviewJson FROM sheet_imports WHERE kind='members'").all();
    const sources = ROSTER_SOURCES.filter(s => selected.branchIds.includes(s.branchId)).map(s => {
      const receipt = receipts.results.find(r => r.id === s.id);
      return {...s, syncedAt:receipt?.syncedAt ?? null,records:receipt?.records ?? 0,review:receipt ? JSON.parse(String(receipt.reviewJson)) : null};
    });
    const events = await db.prepare(`SELECT e.member_id AS memberId,e.period,e.kind,e.observed_at AS observedAt FROM member_month_events e
      JOIN members m ON m.id=e.member_id
      WHERE m.home_branch_id IN (SELECT value FROM json_each(?))`).bind(allowedBranchesJson).all();
    const today = localDay();
    const normalized = members.map(m => ({ ...m, plan:planMonth(m,today.slice(0,7),today)?.plan.label ?? m.plan, status: monthState(m, today.slice(0,7)) }));
    const canViewFinancials = can(access.viewer!.role, "finance.manage");
    const visibleMembers = canViewFinancials ? normalized : normalized.map(m => ({
      id:m.id, name:m.name, branchId:m.branchId, branchName:m.branchName, service:m.service, status:m.status, plan:m.plan,
      importedAt:m.importedAt, missingSince:m.missingSince, sourceState:m.sourceState, review:[], sourceRow:0, sheetId:0, spreadsheetId:"",
      calendarStates:planPeriods(m,today).map(period => {const row=planMonth(m,period,today)!;return {period,status:row.status,plan:row.plan.label};}),
      details:Object.fromEntries(Object.entries(m.details).filter(([key]) => ["Correo", "Teléfono", "Certificado médico", "Fecha de inicio registrada"].includes(key))),
      history:m.history.map(h => ({period:h.period, state:h.state, plan:h.plan, amount:"", date:"", installment:""})),
    }));
    const visibleSources = canViewFinancials ? sources : sources.map(s => ({id:s.id,branchId:s.branchId,branchName:s.branchName,sheetName:s.sheetName,syncedAt:s.syncedAt,records:s.records,review:null,spreadsheetId:"",sheetId:0}));
    return Response.json({ members: visibleMembers, visitors: visitors.results, sources:visibleSources, events: canViewFinancials ? events.results : [], today, viewBranch: branchScope, canViewFinancials,
      canRegisterPayments: canAny(access.viewer!.role,["payments.manage","payments.register"]),
      canForecast: can(access.viewer!.role,"payments.manage"), sourceYear: 2026 },{headers:{"Cache-Control":"no-store"}});
  } catch { console.error("sheet_members_read_failed"); return Response.json({ error: "No se pudieron cargar los socios." }, { status: 500 }); }
}
