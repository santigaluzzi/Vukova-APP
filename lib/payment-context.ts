import { getRawDb } from '@/db';
import { latestCycle, installment, parseMoney, paymentDay, dateAtDay } from '@/lib/member-analytics';
import { addPlanMonths } from '@/lib/member-plan-calendar';
import { attendanceIdentity, attendanceJoins } from '@/lib/attendance-queries';
import { plansFor } from '@/lib/renewal-plans';
import type { SourceMonth } from '@/lib/sheet-data';
export type PaymentMember={id:string;name:string;branchId:string;service:string};
export type InstallmentQuote={contractId:string|null;planId:string;label:string;months:number;installments:number;currency:'ARS'|'USD';amountCents:number;surchargeBps:number;method:string;number:number;dueOn:string;startsOn:string;legacy:boolean};
export async function memberPaymentContext(member:PaymentMember,paidOn:string) {
  const db=getRawDb();
  const [contracts,roster,payments]=await Promise.all([
    db.prepare(`SELECT id,plan_id AS planId,plan_label AS label,coalesce(plan_starts_on,sale_on) AS startsOn,sale_on AS saleOn,months,installments,currency,amount_cents AS amountCents,surcharge_bps AS surchargeBps,method FROM sales_plan_scenarios WHERE member_id=? AND origin='member_sale' AND sale_on<=? ORDER BY coalesce(plan_starts_on,sale_on) DESC,updated_at DESC`).bind(member.id,paidOn).all<InstallmentQuote & {id:string;saleOn:string}>(),
    db.prepare('SELECT history_json AS historyJson FROM sheet_rosters WHERE member_id=? AND archived_at IS NULL').bind(member.id).first<{historyJson:string}>(),
    db.prepare(`SELECT sales_plan_scenario_id AS contractId,coalesce(installment_number,1) AS number,plan_id AS planId,plan_label AS label,coverage_starts_on AS startsOn,coverage_months AS months,coverage_installments AS installments,amount_cents AS amountCents,currency,method,paid_on AS paidOn FROM payments WHERE member_id=? AND status='paid' AND paid_on<=? ORDER BY paid_on DESC,created_at DESC`).bind(member.id,paidOn).all<InstallmentQuote & {paidOn:string}>(),
  ]);
  const history:SourceMonth[]=roster?JSON.parse(roster.historyJson):[];
  const cycle=latestCycle(history,paidOn.slice(0,7));
  const quotes:InstallmentQuote[]=[];
  for(const contract of contracts.results) {
    if(contract.method==='card')continue;
    const paid=payments.results.filter(p=>p.contractId===contract.id).map(p=>p.number);
    const number=Array.from({length:contract.installments},(_,i)=>i+1).find(n=>!paid.includes(n));
    if(number)quotes.push({...contract,contractId:contract.id,number,dueOn:addPlanMonths(contract.startsOn,number-1),legacy:false});
  }
  if(!contracts.results.length) {
    const prior=payments.results.find(p=>!p.contractId&&p.startsOn&&p.months&&p.installments);
    const start=prior?.startsOn??cycle?.start;
    const lastPaid=history.filter(h=>h.period<=paidOn.slice(0,7)&&(parseMoney(h.amount)??0)>0&&installment(h.installment)&&['A','N'].includes(h.state)&&(!start||h.period>=start.slice(0,7))).sort((a,b)=>b.period.localeCompare(a.period))[0];
    const part=installment(lastPaid?.installment??'');
    const candidates=plansFor(member).filter(p=>p.months===cycle?.months&&p.installments===part?.total&&!p.methods.every(m=>m==='card')&&(/YOGA/i.test(cycle?.plan??'')?p.id.startsWith('yoga'):!p.id.startsWith('yoga')));
    const inferred=candidates.length===1?candidates[0]:null;
    const plan=prior?{...prior,id:prior.planId,amountCents:prior.amountCents,surchargeBps:0}:inferred&&lastPaid?{...inferred,amountCents:Math.round((parseMoney(lastPaid.amount)??0)*100),surchargeBps:0,method:'cash'}:null;
    if(start&&plan) {
      const paid=new Set(payments.results.filter(p=>!p.contractId&&p.startsOn===start&&p.planId===plan.id).map(p=>p.number));
      for(const h of history) {const n=installment(h.installment);if(h.period<=paidOn.slice(0,7)&&n&&n.total===plan.installments&&['A','N'].includes(h.state)&&(parseMoney(h.amount)??0)>0&&addPlanMonths(start,n.index-1).slice(0,7)===h.period)paid.add(n.index);}
      const number=Array.from({length:plan.installments},(_,i)=>i+1).find(n=>!paid.has(n));
      if(number)quotes.push({contractId:null,planId:plan.id,label:plan.label,months:plan.months,installments:plan.installments,currency:plan.currency,amountCents:plan.amountCents,surchargeBps:0,method:plan.method??'cash',number,dueOn:addPlanMonths(start,number-1),startsOn:start,legacy:true});
    }
  }
  quotes.sort((a,b)=>a.dueOn.localeCompare(b.dueOn));
  const last=contracts.results[0];
  let previousEndsOn=last?addPlanMonths(last.startsOn,last.months):cycle?.end??null;
  // A dated R with an explicit first instalment is a confirmed new-cycle due date.
  if(!previousEndsOn){const r=history.filter(h=>h.state==='R'&&h.period<=paidOn.slice(0,7)&&installment(h.installment)?.index===1&&paymentDay(h.date,h.period)).sort((a,b)=>b.period.localeCompare(a.period))[0];if(r)previousEndsOn=dateAtDay(r.period,paymentDay(r.date,r.period)!);}
  let attendanceDates:string[]=[];let hasAttendanceSource=false;
  if(previousEndsOn&&previousEndsOn<paidOn&&member.service==='gym') {
    const [sheet,native,sources]=await Promise.all([
      db.prepare(`SELECT DISTINCT a.attended_on AS date FROM sheet_attendance a JOIN sheet_imports i ON i.id=a.import_id AND a.version=json_extract(i.review_json,'$.version') ${attendanceJoins} WHERE ${attendanceIdentity}=? AND a.marker='1' AND a.attended_on>=? AND a.attended_on<?`).bind(member.id,previousEndsOn,paidOn).all<{date:string}>(),
      db.prepare("SELECT DISTINCT date(checked_in_at,'-3 hours') AS date FROM attendance WHERE member_id=? AND date(checked_in_at,'-3 hours')>=? AND date(checked_in_at,'-3 hours')<?").bind(member.id,previousEndsOn,paidOn).all<{date:string}>(),
      db.prepare("SELECT DISTINCT period FROM sheet_imports WHERE kind='attendance' AND branch_id=? AND period>=? AND period<=? AND date(synced_at,'-3 hours')>=?").bind(member.branchId,previousEndsOn.slice(0,7),paidOn.slice(0,7),paidOn).all<{period:string}>(),
    ]);
    attendanceDates=[...new Set([...sheet.results,...native.results].map(r=>r.date))].sort();const periods:string[]=[];for(let period=previousEndsOn.slice(0,7);period<=paidOn.slice(0,7);period=addPlanMonths(`${period}-01`,1).slice(0,7))periods.push(period);hasAttendanceSource=periods.every(period=>sources.results.some(row=>row.period===period));
  }
  const continued=attendanceDates.length>0;
  const startsOn=previousEndsOn&&(previousEndsOn>=paidOn||continued)?previousEndsOn:paidOn;
  const reason=!previousEndsOn?'No hay un vencimiento anterior confirmado.':previousEndsOn>=paidOn?'El nuevo plan comienza al vencer el anterior.':continued?`Se registraron ${attendanceDates.length} asistencia(s) entre el vencimiento y el cobro. Se conserva la fecha anterior.`:'No hay asistencias registradas entre el vencimiento y el cobro. Se propone iniciar al pagar.';
  return {installment:quotes[0]??null,installmentIssue:quotes.length?null:contracts.results.length?'No hay cuotas pendientes en los planes registrados.':'La planilla no permite identificar con certeza el plan, la cuota y el importe. Confirmá esos datos antes de cobrar.',renewal:{previousEndsOn,startsOn,attendanceDates,hasAttendanceSource,requiresConfirmation:!previousEndsOn||previousEndsOn<paidOn&&!continued&&!hasAttendanceSource,reason}};
}
