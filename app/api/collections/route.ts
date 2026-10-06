import {getRawDb} from '@/db';
import {sheetViewer} from '@/lib/sheet-views';
import {effectiveBranchFilter} from '@/lib/branch-filter';
import {isPeriod} from '@/lib/member-analytics';
export async function GET(request:Request){
 const access=await sheetViewer('payments.manage','members');if(access.error)return access.error;
 const p=new URL(request.url).searchParams,period=p.get('period'),page=Number(p.get('page')??0);
 if(!isPeriod(period)||!Number.isInteger(page)||page<0||page>10000)return Response.json({error:'Elegí un mes válido.'},{status:400});
 const scope=effectiveBranchFilter(p.get('branch'),access.viewer!.branchScope);if('error'in scope)return Response.json({error:scope.error},{status:scope.status});
 const db=getRawDb(),ids=JSON.stringify(scope.branchIds),q=`%${(p.get('query')??'').slice(0,120)}%`;
 const where="substr(p.paid_on,1,7)=? AND coalesce(p.sale_branch_id,m.home_branch_id) IN (SELECT value FROM json_each(?)) AND p.status='paid' AND m.full_name LIKE ?";
 const [rows,totals,count]=await Promise.all([
 db.prepare(`SELECT p.id,p.member_id AS memberId,m.full_name AS memberName,b.name AS branchName,p.paid_on AS paidOn,p.due_on AS dueOn,p.sale_kind AS saleKind,p.installment_number AS installmentNumber,coalesce(p.plan_label,s.plan_label) AS planLabel,p.terminal,p.currency,p.amount_cents AS amountCents,p.net_amount_cents AS netCents FROM payments p JOIN members m ON m.id=p.member_id JOIN branches b ON b.id=coalesce(p.sale_branch_id,m.home_branch_id) LEFT JOIN sales_plan_scenarios s ON s.id=p.sales_plan_scenario_id WHERE ${where} ORDER BY p.paid_on DESC,p.created_at DESC,p.id LIMIT 50 OFFSET ?`).bind(period,ids,q,page*50).all(),
 db.prepare(`SELECT p.currency,sum(p.amount_cents) AS grossCents,sum(p.net_amount_cents) AS netCents,sum(CASE WHEN p.net_amount_cents IS NULL THEN 1 ELSE 0 END) AS incomplete FROM payments p JOIN members m ON m.id=p.member_id WHERE ${where} GROUP BY p.currency`).bind(period,ids,q).all(),
 db.prepare(`SELECT count(*) AS total FROM payments p JOIN members m ON m.id=p.member_id WHERE ${where}`).bind(period,ids,q).first<{total:number}>(),
 ]);return Response.json({rows:rows.results,totals:totals.results,total:count?.total??0,page},{headers:{'Cache-Control':'no-store'}});
}
