export type AppPlan = {
  id: string; planId: string; label: string; startsOn: string; months: number;
  installments: number; method: string; currency: string; amountCents: number;
  surchargeBps: number; saleKind: string; createdAt: string;
  settledInstallments?: {number:number;paidOn:string}[];
};
export type AppPayment = {
  id: string; paidOn: string; saleKind: string; planLabel: string;
  installmentNumber: number | null; amountCents: number; currency?: string;
  contractId?: string | null;
};
export type PlanMember = { appPlans?: AppPlan[]; appPayments?: AppPayment[] };
export type PlanDue = { number: number; total: number; dueOn: string; paidOn: string | null; amountCents: number; currency: string; overdue: boolean };
export function addPlanMonths(date: string, count: number) {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + count, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.toISOString().slice(0, 7)}-${String(Math.min(day, last)).padStart(2, "0")}`;
}
const localToday = () => new Intl.DateTimeFormat("sv-SE", {timeZone:"America/Argentina/Buenos_Aires"}).format(new Date());

/** Contract dates are authoritative after an app sale. Scheduled future payments are not presumed overdue. */
export function planMonth(member: PlanMember, period: string, today = localToday()) {
  const periodEnd = `${period}-31`;
  const plan = member.appPlans?.filter(p => p.startsOn <= periodEnd)
    .sort((a,b) => b.startsOn.localeCompare(a.startsOn) || b.createdAt.localeCompare(a.createdAt))[0];
  if (!plan) return null;
  const endsOn = addPlanMonths(plan.startsOn, plan.months);
  const dues: PlanDue[] = Array.from({length: plan.method === "card" ? 1 : plan.installments}, (_,index) => {
    const number = index + 1, dueOn = addPlanMonths(plan.startsOn,index);
    const paidOn = [...(member.appPayments?.filter(p => p.contractId === plan.id && (p.installmentNumber ?? 1) === number && p.paidOn <= periodEnd).map(p => p.paidOn) ?? []),
      ...(plan.settledInstallments?.filter(p => p.number === number && p.paidOn <= periodEnd).map(p => p.paidOn) ?? [])].sort()[0] ?? null;
    return {number,total:plan.method === "card" ? 1 : plan.installments,dueOn,paidOn,
      amountCents:Math.round(plan.amountCents * (10000 + plan.surchargeBps) / 10000) * (plan.method === "card" ? plan.installments : 1),currency:plan.currency,
      overdue:!paidOn && dueOn < today && dueOn <= periodEnd};
  });
  const pending = dues.filter(d => !d.paidOn && d.dueOn <= periodEnd && (d.dueOn.slice(0,7) === period || d.overdue));
  const dueThisMonth = dues.filter(d => d.dueOn.slice(0,7) === period);
  const expires = endsOn.slice(0,7) <= period;
  const isNew = plan.saleKind === "new_member" && plan.startsOn.slice(0,7) === period;
  const status = expires || pending.length ? "renewal" as const : isNew ? "new" as const : "active" as const;
  const dueOn = expires ? endsOn : pending[0]?.dueOn ?? dueThisMonth[0]?.dueOn ?? null;
  const reason = expires ? `${endsOn < today ? "Plan vencido" : "Renovación de plan"}${pending.length ? " · también hay cuotas pendientes" : ""}`
    : pending.length ? pending.map(d => `Cuota ${d.number}/${d.total} ${d.overdue ? "vencida" : "pendiente"}`).join(" · ")
    : dueThisMonth.length ? (plan.method === "card" ? "Plan abonado con tarjeta" : dueThisMonth.map(d => `Cuota ${d.number}/${d.total} pagada`).join(" · "))
    : "Activo · sin cuota programada";
  return {plan,endsOn,status,dueOn,reason,pending,dues,dueThisMonth,expires};
}

export function planPeriods(member: PlanMember, today = localToday()) {
  if (!member.appPlans?.length) return [];
  const first = member.appPlans.map(p => p.startsOn).sort()[0].slice(0,7);
  const last = [...member.appPlans.map(p => addPlanMonths(p.startsOn,p.months).slice(0,7)),today.slice(0,7)].sort().at(-1)!;
  const periods: string[] = [];
  for (let period=first; period<=last; period=addPlanMonths(`${period}-01`,1).slice(0,7)) periods.push(period);
  return periods;
}
