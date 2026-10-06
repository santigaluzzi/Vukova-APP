import { getRawDb } from '@/db';
import { plansFor, type RenewalPlan } from '@/lib/renewal-plans';
export type MonthlyPlan = RenewalPlan & {active:boolean;configured:boolean};
export async function monthlyPlans(period:string,branchId:string,service:string,includeInactive=false):Promise<MonthlyPlan[]> {
  const rows=await getRawDb().prepare(`SELECT plan_key AS planKey,label,service,currency,months,installments,amount_cents AS amountCents,methods_json AS methodsJson,surcharge_bps AS surchargeBps,active FROM monthly_plan_offers WHERE period=? AND branch_id=? AND service=?`).bind(period,branchId,service).all<{planKey:string;label:string;service:'gym'|'pool';currency:'ARS'|'USD';months:number;installments:number;amountCents:number;methodsJson:string;surchargeBps:number;active:number}>();
  const merged=new Map(plansFor({branchId,service}).map(plan=>[plan.id,{...plan,active:true,configured:false}]));
  for(const row of rows.results) merged.set(row.planKey,{id:row.planKey,label:row.label,service:row.service,currency:row.currency,months:row.months,installments:row.installments,amountCents:row.amountCents,methods:JSON.parse(row.methodsJson),surcharge:row.surchargeBps/100,branches:'all',active:!!row.active,configured:true});
  return [...merged.values()].filter(plan=>includeInactive||plan.active);
}
