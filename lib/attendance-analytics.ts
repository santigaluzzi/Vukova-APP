export type AttendancePerson = {
  name: string; normalizedName: string; sourceNames: string[]; branchId?: string; memberId: string | null;
  memberName: string | null; memberStatus: string | null; otherBranch: boolean;
  dates: string[]; reviewDates: string[]; duplicates: number;
};
export type CohortMember = { id: string; name: string; normalizedName: string; branchId?: string; state: string; review: string[] };
export type ActiveVisitor = { name: string; normalizedName: string; declaredAt: string };
export type AttendancePeriod = { period: string; syncedAt: string };
export type DailyCount = { date: string; total: number };
export type AttendanceRange = { id: string; label: string; start: string; end: string; days: number };
export type AnalyticsPerson = AttendancePerson & { id: string; displayName: string; expected: boolean; needsReview: boolean; monthlyTotal: number; weeklyAverage: number | null };
export type Frequency = "all" | "zero" | "under-one" | "one" | "two" | "three-plus";
export type AttendanceAnalytics = ReturnType<typeof buildAttendanceAnalytics>;

const DAY = 86_400_000;
const dayNumber = (date: string) => Date.parse(`${date}T12:00:00Z`) / DAY;
export const daysBetween = (start: string, end: string) => Math.max(0, Math.round(dayNumber(end) - dayNumber(start)) + 1);
export const monthEnd = (period: string) => new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5,7)),0,12)).toISOString().slice(0,10);
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days*DAY).toISOString().slice(0,10);
export function argentinaDay(value: string | Date) { return new Intl.DateTimeFormat("sv-SE",{timeZone:"America/Argentina/Buenos_Aires"}).format(new Date(value)); }
export function observedThrough(period: string, syncedAt: string, today: string) { return [monthEnd(period),argentinaDay(syncedAt),today].sort()[0]; }
const shortDate = (value: string) => `${Number(value.slice(8,10))}/${Number(value.slice(5,7))}`;

export function attendanceRanges(period: string, through: string, kind: "month" | "fortnight" | "week"): AttendanceRange[] {
  const start = `${period}-01`; const end = [through,monthEnd(period)].sort()[0];
  if (end < start) return [];
  if (kind === "month") return [{id:"month",label:`${shortDate(start)} al ${shortDate(end)}`,start,end,days:daysBetween(start,end)}];
  if (kind === "fortnight") return [1,16].flatMap(day => {
    const first = `${period}-${String(day).padStart(2,"0")}`; const last = [day === 1 ? `${period}-15` : monthEnd(period),end].sort()[0];
    return first > last ? [] : [{id:`half-${day}`,label:`${day === 1 ? "1.ª" : "2.ª"} quincena · ${shortDate(first)} al ${shortDate(last)}`,start:first,end:last,days:daysBetween(first,last)}];
  });
  const result: AttendanceRange[] = [];
  for (let first=start;first<=end;) {
    const weekDay = (new Date(`${first}T12:00:00Z`).getUTCDay()+6)%7;
    const last = [addDays(first,6-weekDay),end].sort()[0];
    result.push({id:first,label:`${shortDate(first)} al ${shortDate(last)}${daysBetween(first,last)<7 ? " · parcial" : ""}`,start:first,end:last,days:daysBetween(first,last)});
    first=addDays(last,1);
  }
  return result;
}

export function matchesFrequency(person: Pick<AnalyticsPerson,"weeklyAverage"|"monthlyTotal">, frequency: Frequency) {
  if (frequency === "all") return true;
  const average = person.weeklyAverage;
  if (average === null) return false;
  if (frequency === "zero") return person.monthlyTotal === 0;
  if (frequency === "under-one") return average > 0 && average < 1;
  if (frequency === "one") return average >= 1 && average < 2;
  if (frequency === "two") return average >= 2 && average < 3;
  return average >= 3;
}

export function rankAttendance(people: AnalyticsPerson[], range: AttendanceRange, options: {query:string;frequency:Frequency;sort:"most"|"least"|"name";onlyReview:boolean}) {
  const normalize = (name:string) => name.normalize("NFD").replace(/\p{Diacritic}/gu,"").toLocaleLowerCase("es");
  const query = normalize(options.query.trim());
  return people.filter(p => (!options.onlyReview || p.needsReview) && matchesFrequency(p,options.frequency) && normalize(`${p.displayName} ${p.sourceNames.join(" ")}`).includes(query))
    .map(p => ({...p,rangeTotal:p.dates.filter(d => d>=range.start && d<=range.end).length}))
    .sort((a,b) => (options.sort === "name" ? 0 : (options.sort === "most" ? b.rangeTotal-a.rangeTotal : a.rangeTotal-b.rangeTotal)) || a.displayName.localeCompare(b.displayName,"es") || a.id.localeCompare(b.id));
}

export function buildAttendanceAnalytics(input: {period:string;syncedAt:string;today:string;rows:AttendancePerson[];cohort:CohortMember[];visitors:ActiveVisitor[];periods:AttendancePeriod[];counts:DailyCount[]}) {
  const {period,rows,cohort,visitors} = input; const through = observedThrough(period,input.syncedAt,input.today);
  const start = `${period}-01`; const elapsedDays = daysBetween(start,through);
  const expectedIds = new Set(cohort.filter(m => ["A","N","R"].includes(m.state)).map(m => m.id));
  const people = new Map<string,AnalyticsPerson>();
  function add(row: AttendancePerson, expected: boolean, identityReview = false) {
    const id = row.memberId ? `member:${row.memberId}` : `name:${row.branchId ?? "branch-acassuso"}:${row.normalizedName}`;
    const dates = [...new Set(row.dates.filter(d => d>=start && d<=through))].sort();
    const reviewDates = row.reviewDates.filter(d => d.slice(0,10)>=start && d.slice(0,10)<=through);
    people.set(id,{...row,dates,reviewDates,id,displayName:row.memberName || row.name,expected,
      needsReview:identityReview || (!row.memberId && !row.otherBranch) || reviewDates.length>0,
      monthlyTotal:dates.length,weeklyAverage:reviewDates.length || !elapsedDays ? null : dates.length*7/elapsedDays});
  }
  for (const row of rows) add(row,!!row.memberId && expectedIds.has(row.memberId) || row.otherBranch,cohort.find(m => m.id===row.memberId)?.review.length ? true : false);
  for (const member of cohort) {
    if (!expectedIds.has(member.id) || people.has(`member:${member.id}`)) continue;
    add({name:member.name,normalizedName:member.normalizedName,sourceNames:[],branchId:member.branchId,memberId:member.id,memberName:member.name,memberStatus:member.state==="R"?"renewal":"active",otherBranch:false,dates:[],reviewDates:[],duplicates:0},true,member.review.length>0);
  }
  for (const visitor of visitors) {
    // The active declaration starts in its own month; it is not evidence of a
    // membership in earlier months. Visitors already linked are excluded by SQL.
    if (argentinaDay(visitor.declaredAt).slice(0,7)>period || people.has(`name:branch-acassuso:${visitor.normalizedName}`)) continue;
    add({name:visitor.name,normalizedName:visitor.normalizedName,sourceNames:[],branchId:"branch-acassuso",memberId:null,memberName:null,memberStatus:"active",otherBranch:true,dates:[],reviewDates:[],duplicates:0},true);
  }
  const daily: DailyCount[] = Array.from({length:elapsedDays},(_,i)=>({date:addDays(start,i),total:0}));
  const dailyMap = new Map(daily.map(d=>[d.date,d]));
  for (const person of people.values()) for (const day of person.dates) { const entry=dailyMap.get(day);if(entry)entry.total++; }
  const total=daily.reduce((s,d)=>s+d.total,0);
  const weeks=attendanceRanges(period,through,"week").map(w=>({...w,total:daily.filter(d=>d.date>=w.start&&d.date<=w.end).reduce((s,d)=>s+d.total,0)}));
  const weekdays=["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"].map(label=>({label,total:0,days:0,average:0}));
  for (const d of daily) { const index=(new Date(`${d.date}T12:00:00Z`).getUTCDay()+6)%7;weekdays[index].total+=d.total;weekdays[index].days++; }
  for (const weekday of weekdays) weekday.average=weekday.days ? weekday.total/weekday.days : 0;
  const monthly=input.periods.filter(p=>p.period.slice(0,4)===period.slice(0,4)&&p.period<=period).sort((a,b)=>a.period.localeCompare(b.period)).map(p=>{
    const end=observedThrough(p.period,p.syncedAt,input.today);
    return {period:p.period,through:end,total:p.period===period?total:input.counts.filter(d=>d.date.slice(0,7)===p.period&&d.date<=end).reduce((s,d)=>s+d.total,0),complete:p.period<input.today.slice(0,7)&&end===monthEnd(p.period)};
  });
  const completedMonths=monthly.filter(m=>m.complete);
  return {period,through,elapsedDays,total,daily,weeks,weekdays,monthly,people:[...people.values()],
    averageDaily:elapsedDays?total/elapsedDays:0,averageWeekly:elapsedDays?total*7/elapsedDays:0,
    averageMonthly:completedMonths.length?completedMonths.reduce((s,m)=>s+m.total,0)/completedMonths.length:null,
    completedMonths:completedMonths.length,attending:people.size?[...people.values()].filter(p=>p.monthlyTotal>0).length:0,
    zeroExpected:[...people.values()].filter(p=>p.expected&&p.monthlyTotal===0&&p.weeklyAverage!==null).length,
    reviewCount:[...people.values()].filter(p=>p.needsReview).length};
}
