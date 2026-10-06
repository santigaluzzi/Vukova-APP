import type { SourceMonth } from "./sheet-data";
import { planMonth, type AppPlan, type AppPayment } from "./member-plan-calendar.ts";

export type MemberState = "active" | "new" | "renewal" | "departed" | "inactive" | "review";
export type RosterMember = {
  id: string; name: string; branchId: string; branchName: string; service: string;
  status: string; plan: string | null; history: SourceMonth[]; importedAt: string;
  missingSince: string | null; sourceState: string; review: string[];
  sourceRow: number; sheetId: number; spreadsheetId: string; details: Record<string, string>;
  appPayments?: AppPayment[];
  appPlans?: AppPlan[];
  calendarStates?: {period:string;status:MemberState;plan:string}[];
};
export type MonthEvent = { memberId: string; period: string; kind: "new" | "departed" | "renewal"; observedAt?: string };
export const stateLabels: Record<MemberState, string> = {
  active: "Activo", renewal: "Renovación", new: "Nuevo", departed: "Baja", inactive: "Inactivo", review: "Por revisar",
};
export const currentPeriod = () => argentinaDay().slice(0, 7);
export function argentinaDay(value: Date | string = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(value));
}
export function shiftPeriod(period: string, months: number) {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + months, 1)).toISOString().slice(0, 7);
}
export function daysInMonth(period: string) {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
export function isPeriod(value: unknown): value is string { return typeof value === "string" && /^20\d{2}-(0[1-9]|1[0-2])$/.test(value); }
export function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^20\d{2}-(0[1-9]|1[0-2])-\d{2}$/.test(value)) return false;
  return Number(value.slice(8)) >= 1 && Number(value.slice(8)) <= daysInMonth(value.slice(0, 7));
}
export function dateAtDay(period: string, day: number) { return `${period}-${String(Math.min(day, daysInMonth(period))).padStart(2, "0")}`; }

/** A standalone number is a billing day; full dates must belong to the source month. Text is never guessed. */
export function paymentDay(raw: string | undefined, period: string): number | null {
  const value = (raw ?? "").trim();
  if (/^\d{1,2}$/.test(value)) { const day = Number(value); return day >= 1 && day <= 31 ? day : null; }
  if (isDate(value)) return value.slice(0, 7) === period ? Number(value.slice(8)) : null;
  const match = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?$/.exec(value);
  if (!match) return null;
  const year = match[3] ? (match[3].length === 2 ? `20${match[3]}` : match[3]) : period.slice(0, 4);
  const iso = `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  return isDate(iso) && iso.slice(0, 7) === period ? Number(match[1]) : null;
}
export function parseMoney(raw: string): number | null {
  const value = raw.replace(/(?:ARS|USD|US\$|\$|\s)/gi, "");
  if (!value || !/^-?[\d.,]+$/.test(value)) return null;
  const cleaned = value.includes(",") ? value.replace(/\./g, "").replace(",", ".") : /^-?\d{1,3}(\.\d{3})+$/.test(value) ? value.replace(/\./g, "") : value;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}
export function installment(raw: string) {
  const match = /^(\d{1,2})\s*\/\s*(\d{1,2})$/.exec(raw.trim());
  if (!match) return null;
  const index = Number(match[1]), total = Number(match[2]);
  return index > 0 && total >= index && total <= 36 ? { index, total } : null;
}
export function planMonths(raw: string) {
  const value = raw.toUpperCase().trim();
  if (/\bANUAL\b/.test(value)) return 12;
  if (/\bMENSUAL\b/.test(value)) return 1;
  if (/\bSEMESTRAL\b/.test(value)) return 6;
  const match = /\b(\d{1,2})\s*M(?:ESES|ES)?\b/.exec(value);
  return match && Number(match[1]) > 0 && Number(match[1]) <= 36 ? Number(match[1]) : null;
}
export function monthState(member: Pick<RosterMember, "history" | "importedAt" | "missingSince" | "appPlans" | "appPayments" | "calendarStates">, period: string): MemberState {
  const calendar = planMonth(member,period);
  if (calendar) return calendar.status;
  const known = member.calendarStates?.find(row => row.period === period);
  if (known) return known.status;
  const appPayment = member.appPayments?.find(p => p.paidOn.slice(0, 7) === period);
  if (appPayment) return appPayment.saleKind === "new_member" ? "new" : "active";
  if (member.missingSince && argentinaDay(member.missingSince).slice(0, 7) <= period) return "review";
  const importedPeriod = argentinaDay(member.importedAt).slice(0, 7);
  // At midnight, rotate last month's badges without waiting for the hourly import.
  // Once the new month's sheet is read, explicit cells (including blanks) take priority.
  if (period > importedPeriod) {
    const previous = monthState({ ...member, missingSince: null }, importedPeriod);
    return previous === "new" ? "active" : previous === "departed" ? "inactive" : previous;
  }
  const state = member.history.find(h => h.period === period)?.state.trim().toUpperCase() ?? "";
  if (!state) return "inactive";
  if (state === "A") return "active";
  if (state === "R") return "renewal";
  if (state === "N") return member.history.find(h => h.period === shiftPeriod(period, -1))?.state.trim().toUpperCase() === "N" ? "active" : "new";
  if (state === "B") {
    const previous = member.history.filter(h => h.period < period && h.state).sort((a, b) => b.period.localeCompare(a.period))[0];
    return previous?.state === "B" ? "inactive" : "departed";
  }
  return "review";
}
export function memberMonth(member: RosterMember, period: string) {
  const calendar = planMonth(member,period);
  const record = member.history.find(h => h.period === period);
  const appPayment = member.appPayments?.find(p => p.paidOn.slice(0, 7) === period);
  const available = member.history.filter(h => h.period <= period).sort((a, b) => b.period.localeCompare(a.period));
  const plan = calendar?.plan.label || member.calendarStates?.find(row => row.period === period)?.plan || appPayment?.planLabel || record?.plan || available.find(h => h.plan)?.plan || "";
  return { status: monthState(member, period), record, plan, calendar, day: calendar ? (calendar.dueOn ? Number(calendar.dueOn.slice(8,10)) : null) : appPayment ? Number(appPayment.paidOn.slice(8, 10)) : paymentDay(record?.date, period) };
}
export function matchesPaymentBand(day: number | null, band: string) {
  if (band === "all") return true;
  if (band === "unknown") return day === null;
  const [min, max] = band.split("-").map(Number);
  return day !== null && day >= min && day <= max;
}

export type PlanCycle = { start: string; end: string; plan: string; months: number; startPeriod: string };
export function latestCycle(history: SourceMonth[], through: string): PlanCycle | null {
  let cycle: PlanCycle | null = null;
  let plan = "";
  for (const h of [...history].sort((a, b) => a.period.localeCompare(b.period))) {
    if (h.period > through) break;
    if (h.state === "B") { cycle = null; plan = ""; continue; }
    if (!["A", "N", "R"].includes(h.state)) continue;
    plan = h.plan || plan;
    const duration = planMonths(plan), day = paymentDay(h.date, h.period), part = installment(h.installment);
    const paid = (parseMoney(h.amount) ?? 0) > 0;
    // Fractions describe installments, never the length of a membership.
    const start = (h.state === "N" || paid) && (!part || part.index === 1) && h.state !== "R";
    if (start) {
      if (!duration || !day || (h.state !== "N" && duration !== 1 && !part)) { cycle = null; continue; }
      cycle = { start: dateAtDay(h.period, day), end: dateAtDay(shiftPeriod(h.period, duration), day), months: duration, plan, startPeriod: h.period };
    } else if (cycle && h.plan && planMonths(h.plan) !== cycle.months) cycle = null;
  }
  return cycle;
}

/** Conservative evidence: a paid new cycle after an existing cycle, never an intermediate installment. */
export function renewalEvidence(history: SourceMonth[], period: string, observedFrom?: string) {
  const h = history.find(row => row.period === period);
  if (!h || h.state !== "A" || (parseMoney(h.amount) ?? 0) <= 0 || paymentDay(h.date, period) === null) return false;
  const part = installment(h.installment);
  if (part && part.index !== 1) return false;
  const months = planMonths(h.plan);
  if (!months || (!part && months !== 1)) return false;
  const previous = history.find(row => row.period === shiftPeriod(period, -1));
  if (!previous || !["A", "N", "R"].includes(previous.state)) return false;
  if (observedFrom === "R") return true;
  const cycle = latestCycle(history, shiftPeriod(period, -1));
  return !!cycle && cycle.end.slice(0, 7) === period;
}
export function changedMonthEvents(before: SourceMonth[], after: SourceMonth[], through: string): Omit<MonthEvent, "memberId">[] {
  const events: Omit<MonthEvent, "memberId">[] = [];
  for (const h of after) {
    if (h.period > through) continue;
    const prior = before.find(p => p.period === h.period);
    if (!prior || prior.state === h.state) continue;
    const priorMonth = before.find(p => p.period === shiftPeriod(h.period, -1));
    const lastPriorState = before.filter(p => p.period < h.period && p.state).sort((a,b) => b.period.localeCompare(a.period))[0];
    if (prior.state === "N" && h.state === "A" && priorMonth?.state !== "N") events.push({ period: h.period, kind: "new" });
    if (prior.state === "B" && ["A", "N", "R"].includes(h.state) && lastPriorState?.state !== "B") events.push({ period: h.period, kind: "departed" });
    if (renewalEvidence(after, h.period, prior.state)) events.push({ period: h.period, kind: "renewal" });
  }
  return events;
}
const activeStates = new Set<MemberState>(["active", "new", "renewal"]);
export const isActiveState = (state: MemberState) => activeStates.has(state);
export function monthlySummary(members: RosterMember[], period: string, events: MonthEvent[], today = argentinaDay()) {
  const previous = shiftPeriod(period, -1);
  const openingKnown = members.length > 0 && members.every(m => m.history.some(h => h.period === previous));
  const eventsFor = (id: string, kind: MonthEvent["kind"]) => events.some(e => e.memberId === id && e.period === period && e.kind === kind);
  const renewed = members.filter(m => renewalEvidence(m.history, period) || eventsFor(m.id, "renewal"));
  const newMembers = members.filter(m => monthState(m, period) === "new" || eventsFor(m.id, "new"));
  const departed = members.filter(m => monthState(m, period) === "departed" || eventsFor(m.id, "departed"));
  const ending = members.filter(m => isActiveState(monthState(m, period))).length;
  const opening = openingKnown ? members.filter(m => isActiveState(monthState(m, previous))).length : null;
  const uncertainRenewals = members.filter(m => {
    const h = m.history.find(row => row.period === period), part = installment(h?.installment ?? "");
    return h?.state === "A" && (parseMoney(h.amount) ?? 0) > 0 && (!part || part.index === 1) && !renewed.some(r => r.id === m.id) && !newMembers.some(n => n.id === m.id);
  }).length;
  const closed = period < today.slice(0, 7) && members.every(m => argentinaDay(m.importedAt).slice(0, 7) > period);
  return { period, opening, ending, newMembers: newMembers.length, renewed: renewed.length, departed: departed.length, uncertainRenewals,
    unclassified: members.filter(m => monthState(m, period) === "review").length, closed,
    adjustment: opening === null ? null : ending - opening - newMembers.length + departed.length };
}

export type RenewalCandidate = { member: RosterMember; dueOn: string | null; reason: string; projected: boolean };
export function renewalCandidate(member: RosterMember, target: string, today = argentinaDay()): RenewalCandidate | null {
  const calendar = planMonth(member,target,today);
  if (calendar) {
    if (!calendar.expires) return null;
    return {member,dueOn:calendar.endsOn,reason:`${calendar.reason} · ${calendar.plan.label}`,projected:false};
  }
  if (!isActiveState(monthState(member, today.slice(0, 7)))) return null;
  const explicit = member.history.find(h => h.period === target && h.state === "R");
  if (explicit) {
    const day = paymentDay(explicit.date, target);
    return { member, dueOn: day ? dateAtDay(target, day) : null, reason: "R registrada; confirmar que sea renovación y no cuota", projected: false };
  }
  const cycle = latestCycle(member.history, today.slice(0, 7));
  if (cycle && cycle.end.slice(0, 7) === target) return { member, dueOn: cycle.end, reason: `Vencimiento estimado · ${cycle.months} meses desde ${cycle.start.split("-").reverse().join("/")}`, projected: true };
  if (!cycle || cycle.end < today) return { member, dueOn: null, reason: cycle ? "Vencimiento anterior; revisar continuidad" : "Falta confirmar inicio, duración o fecha del plan", projected: false };
  return null;
}
