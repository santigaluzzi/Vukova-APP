import { getRawDb } from '@/db';
import { sheetViewer } from '@/lib/sheet-views';
import { isDate } from '@/lib/member-analytics';
import { localDay } from '@/lib/sheet-data';
import { memberPaymentContext, type PaymentMember } from '@/lib/payment-context';
export async function GET(request:Request){
 const access=await sheetViewer('payments.manage','members');if(access.error)return access.error;
 const p=new URL(request.url).searchParams,paidOn=p.get('paidOn')??localDay();if(!isDate(paidOn)||paidOn>localDay())return Response.json({error:'Fecha inválida.'},{status:400});
 const member=await getRawDb().prepare("SELECT id,full_name AS name,home_branch_id AS branchId,coalesce(service,'gym') AS service FROM members WHERE id=? AND (?='all' OR home_branch_id=?)").bind(p.get('memberId'),access.viewer!.branchScope,access.viewer!.branchScope).first<PaymentMember>();
 if(!member)return Response.json({error:'No se encontró el socio en tu sede.'},{status:404});
 return Response.json(await memberPaymentContext(member,paidOn),{headers:{'Cache-Control':'no-store'}});
}
