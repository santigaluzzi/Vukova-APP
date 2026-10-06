import { getRawDb } from '@/db';
import { sheetViewer } from '@/lib/sheet-views';
import { rejectUnsafeRequest } from '@/lib/auth-security';
import { isPeriod } from '@/lib/member-analytics';
import { effectiveBranchFilter } from '@/lib/branch-filter';
import { scopeBranchIds } from '@/lib/permissions';
import { defaultBranches } from '@/lib/branch-catalog';
import { monthlyPlans } from '@/lib/monthly-plans';
export async function GET(request:Request) {
  const access=await sheetViewer('payments.manage','members');if(access.error)return access.error;
  const params=new URL(request.url).searchParams,period=params.get('period');
  if(!isPeriod(period))return Response.json({error:'Elegí el mes del catálogo.'},{status:400});
  const selected=effectiveBranchFilter(params.get('branch'),access.viewer!.branchScope);if('error' in selected)return Response.json({error:selected.error},{status:selected.status});
  const rows=(await Promise.all(selected.branchIds.flatMap(branchId=>(branchId==='branch-acassuso'?['gym','pool']:['gym']).map(async service=>({branchId,service,plans:await monthlyPlans(period,branchId,service,params.get('includeInactive')==='1')})))));
  return Response.json({period,rows,branches:defaultBranches.filter(b=>scopeBranchIds(access.viewer!.branchScope).includes(b.id))},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(request:Request) {
  const rejected=rejectUnsafeRequest(request);if(rejected)return rejected;
  const access=await sheetViewer('payments.manage','members');if(access.error)return access.error;
  let body:{period:string;branchIds:string[];plan:{id?:string;label:string;service:string;currency:string;months:number;installments:number;amountCents:number;surchargeBps:number;methods:string[];active:boolean}};try{body=await request.json() as typeof body;}catch{return Response.json({error:'Datos inválidos.'},{status:400});}
  const allowed=scopeBranchIds(access.viewer!.branchScope);
  if(!isPeriod(body?.period)||!Array.isArray(body.branchIds)||!body.branchIds.length||body.branchIds.some((id:unknown)=>typeof id!=='string'||!allowed.includes(id)))return Response.json({error:'Revisá el mes y las sedes asignadas.'},{status:400});
  const p=body.plan;
  if(!p||typeof p.label!=='string'||!p.label.trim()||p.label.length>140||!['gym','pool'].includes(p.service)||!['ARS','USD'].includes(p.currency)||!Number.isInteger(p.months)||p.months<1||p.months>36||!Number.isInteger(p.installments)||p.installments<1||p.installments>36||!Number.isSafeInteger(p.amountCents)||p.amountCents<1||p.amountCents>100000000000||!Number.isInteger(p.surchargeBps)||p.surchargeBps<0||p.surchargeBps>10000||!Array.isArray(p.methods)||!p.methods.length||p.methods.some((m:string)=>!['cash','transfer','card'].includes(m))||typeof p.active!=='boolean'||(p.methods.some((m:string)=>m!=='card')&&p.installments>p.months)||(p.currency==='USD'&&p.methods.some((m:string)=>m!=='cash'))||(p.service==='pool'&&body.branchIds.some((id:string)=>id!=='branch-acassuso')))return Response.json({error:'Revisá nombre, duración, cuotas, precio y medios de pago. Pileta corresponde a Acassuso.'},{status:400});
  const key=typeof p.id==='string'&&/^[a-z0-9-]{1,80}$/.test(p.id)?p.id:`offer-${crypto.randomUUID()}`,now=new Date().toISOString(),db=getRawDb();
  const statements=[...new Set(body.branchIds as string[])].map(branchId=>db.prepare(`INSERT INTO monthly_plan_offers (id,period,branch_id,plan_key,label,service,currency,months,installments,amount_cents,methods_json,surcharge_bps,active,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(period,branch_id,plan_key) DO UPDATE SET label=excluded.label,service=excluded.service,currency=excluded.currency,months=excluded.months,installments=excluded.installments,amount_cents=excluded.amount_cents,methods_json=excluded.methods_json,surcharge_bps=excluded.surcharge_bps,active=excluded.active,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).bind(`${body.period}:${branchId}:${key}`,body.period,branchId,key,p.label.trim(),p.service,p.currency,p.months,p.installments,p.amountCents,JSON.stringify([...new Set(p.methods)]),p.surchargeBps,p.active?1:0,access.viewer!.id,now));
  statements.push(db.prepare('INSERT INTO audit_logs (id,employee_id,action,entity_type,entity_id,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),access.viewer!.id,'monthly_plan.saved','plan',key,JSON.stringify({period:body.period,branchIds:body.branchIds}),now,now));
  await db.batch(statements);return Response.json({ok:true,planId:key});
}
