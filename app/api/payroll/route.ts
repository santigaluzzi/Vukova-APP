import { getRawDb } from "@/db";
import { getCurrentEmployee } from "@/lib/auth";
import { rejectUnsafeRequest } from "@/lib/auth-security";
import { effectiveBranchFilter } from "@/lib/branch-filter";
import { defaultBranches } from "@/lib/branch-catalog";
import { can, employeeScope, hasBranchAccess, normalizeRole, scopeBranchIds } from "@/lib/permissions";
import { argentinaDay, daysInMonth, isDate, isPeriod } from "@/lib/member-analytics";
import { calculatePayroll, type HourlyRate, type PayrollBonus, type PayrollEmployee, type PayrollSale, type PayrollSetting, type WorkEntry } from "@/lib/payroll";

async function payrollViewer() {
  const viewer=await getCurrentEmployee();
  if(!viewer) return {error:Response.json({error:"Ingresá con tu cuenta."},{status:401})};
  if(!can(viewer.role,"payroll.self")||!scopeBranchIds(viewer.branchScope).length) return {error:Response.json({error:"Tu cuenta no tiene acceso a horas y sueldos."},{status:403})};
  return {viewer};
}
const feeColumns=["collection_fee_ppm","collection_fee_vat_ppm","financing_fee_ppm","financing_fee_vat_ppm","other_cost_ppm","other_tax_ppm","iibb_retention_ppm"];
export async function GET(request:Request) {
  const access=await payrollViewer();if(access.error)return access.error;
  const viewer=access.viewer!,params=new URL(request.url).searchParams,period=params.get("period")??argentinaDay().slice(0,7);
  if(!isPeriod(period))return Response.json({error:"Seleccioná un mes válido."},{status:400});
  const scope=params.get("scope")??"self",manage=can(viewer.role,"payroll.manage");
  if(!["self","team"].includes(scope))return Response.json({error:"Vista inválida."},{status:400});
  if(scope==="team"&&!manage)return Response.json({error:"Solo el encargado y el administrador general pueden consultar sueldos del equipo."},{status:403});
  const selection=effectiveBranchFilter(params.get("branch"),viewer.branchScope);
  if("error" in selection)return Response.json({error:selection.error},{status:selection.status});
  try {
    const db=getRawDb(),branchesJson=JSON.stringify(selection.branchIds),start=`${period}-01`,end=`${period}-${daysInMonth(period)}`;
    const [staff,work,rateData,settings,bonuses,payments]=await Promise.all([
      db.prepare("SELECT id,display_name AS name,role,branch_scope AS branchScope,active FROM employees").all<{id:string;name:string;role:string;branchScope:string;active:number}>(),
      db.prepare("SELECT id,employee_id AS employeeId,branch_id AS branchId,work_on AS workOn,minutes,work_role AS workRole,note,updated_at AS updatedAt FROM work_entries WHERE branch_id IN (SELECT value FROM json_each(?)) AND work_on>=? AND work_on<=? UNION ALL SELECT id,employee_id AS employeeId,branch_id AS branchId,work_on AS workOn,(end_hour-start_hour)*60 AS minutes,'teacher' AS workRole,note,updated_at AS updatedAt FROM work_shift_records WHERE status IN ('confirmed','validated') AND branch_id IN (SELECT value FROM json_each(?)) AND work_on>=? AND work_on<=? ORDER BY workOn DESC,employeeId")
        .bind(branchesJson,start,end,branchesJson,start,end).all<WorkEntry>(),
      db.prepare("SELECT id,employee_id AS employeeId,branch_id AS branchId,effective_from AS effectiveFrom,amount_cents AS amountCents FROM hourly_rates WHERE branch_id IN (SELECT value FROM json_each(?)) AND effective_from<=? ORDER BY effective_from DESC")
        .bind(branchesJson,end).all<HourlyRate>(),
      db.prepare("SELECT branch_id AS branchId,commission_bps AS commissionBps FROM payroll_month_settings WHERE period=? AND branch_id IN (SELECT value FROM json_each(?))").bind(period,branchesJson).all<PayrollSetting>(),
      db.prepare("SELECT employee_id AS employeeId,branch_id AS branchId,eligible FROM payroll_bonuses WHERE period=? AND branch_id IN (SELECT value FROM json_each(?))").bind(period,branchesJson).all<PayrollBonus>(),
      db.prepare(`SELECT p.id,coalesce(p.sale_branch_id,s.branch_id,m.home_branch_id) AS branchId,p.currency,p.method,p.gross_amount_cents AS grossCents,p.net_amount_cents AS storedNet,s.id AS scenarioId,
        coalesce(p.sale_kind,CASE WHEN EXISTS(SELECT 1 FROM audit_logs a WHERE a.entity_type='payment' AND a.entity_id=p.id AND a.action='member.created_with_payment') THEN 'new_member' WHEN EXISTS(SELECT 1 FROM audit_logs a WHERE a.entity_type='payment' AND a.entity_id=p.id AND a.action='renewal.paid') THEN 'renewal' END) AS kind,
        ${feeColumns.map(c=>`s.${c}`).join(",")},s.fixed_cost_cents
        FROM payments p JOIN members m ON m.id=p.member_id LEFT JOIN sales_plan_scenarios s ON s.id=p.sales_plan_scenario_id
        WHERE p.status='paid' AND p.paid_on>=? AND p.paid_on<=? AND coalesce(p.sale_branch_id,s.branch_id,m.home_branch_id) IN (SELECT value FROM json_each(?))`)
        .bind(start,end,branchesJson).all<Record<string,unknown>>(),
    ]);
    const employees:PayrollEmployee[]=staff.results.map(e=>{const role=normalizeRole(e.role);return {id:e.id,name:e.name,role:role??"unknown",branchIds:role?scopeBranchIds(employeeScope(role,e.branchScope)).filter(id=>selection.branchIds.includes(id)):[],active:!!e.active};})
      .filter(e=>e.branchIds.length||work.results.some(w=>w.employeeId===e.id));
    const sales:PayrollSale[]=payments.results.map(p=>{
      let net=p.storedNet===null?null:Number(p.storedNet);
      if(p.grossCents!==null&&p.scenarioId) {
        const gross=Number(p.grossCents);
        if(p.method==="cash")net=gross;
        else if(p.method==="transfer")net=gross-Math.round(gross*21/100);
        else if(feeColumns.some(c=>p[c]===null)||p.fixed_cost_cents===null)net=null;
        else net=gross-Math.round(gross*21/100)-feeColumns.reduce((sum,c)=>sum+Math.round(gross*Number(p[c])/1000000),Number(p.fixed_cost_cents));
      }
      return {id:String(p.id),branchId:String(p.branchId),currency:String(p.currency),kind:p.kind?String(p.kind):null,netCents:net};
    });
    const result=calculatePayroll({employees,entries:work.results,rates:rateData.results,settings:settings.results,bonuses:bonuses.results,sales,branchIds:selection.branchIds});
    const visible=(id:string)=>scope==="team"||id===viewer.id;
    // Personal views receive only their own compensation; never branch revenue or colleagues' pay.
    return Response.json({period,today:argentinaDay(),scope,canManage:manage,branches:defaultBranches.filter(b=>selection.branchIds.includes(b.id)).map(b=>({id:b.id,name:b.name})),
      employees:employees.filter(e=>visible(e.id)),entries:work.results.filter(e=>visible(e.employeeId)),rates:rateData.results.filter(r=>visible(r.employeeId)),
      rows:result.rows.filter(r=>visible(r.employeeId)),funds:scope==="team"?result.funds:[]},{headers:{"Cache-Control":"no-store"}});
  } catch {console.error("payroll_read_failed");return Response.json({error:"No se pudieron calcular las horas y los sueldos."},{status:500});}
}

export async function POST(request:Request) {
  const rejected=rejectUnsafeRequest(request);if(rejected)return rejected;
  const access=await payrollViewer();if(access.error)return access.error;
  const viewer=access.viewer!;
  let body:Record<string,unknown>;
  try{body=await request.json();}catch{return Response.json({error:"Datos inválidos."},{status:400});}
  if(!body||typeof body.action!=="string"||typeof body.branchId!=="string"||!hasBranchAccess(viewer.branchScope,body.branchId))return Response.json({error:"Elegí una sede autorizada."},{status:403});
  const branchId=body.branchId,db=getRawDb(),now=new Date().toISOString(),today=argentinaDay();
  const audit=(action:string,id:string,details:unknown)=>db.prepare("INSERT INTO audit_logs (id,employee_id,action,entity_type,entity_id,metadata_json,created_at,updated_at) VALUES (?,?,?,'payroll',?,?,?,?)").bind(crypto.randomUUID(),viewer.id,action,id,JSON.stringify(details),now,now);
  try {
    if(body.action==="hours"||body.action==="delete_hours") {
      if(viewer.role==="teacher")return Response.json({error:"Los profesores confirman sus turnos desde Mi calendario. Las modificaciones requieren aprobación de coordinación."},{status:403});
      if(viewer.role==="admin"||body.employeeId!==undefined&&body.employeeId!==viewer.id)return Response.json({error:"Cada empleado registra sus propias horas."},{status:403});
      if(!isDate(body.workOn)||body.workOn>today)return Response.json({error:"Elegí un día válido, hasta hoy."},{status:400});
      const id=`${viewer.id}:${branchId}:${body.workOn}`;
      if(body.action==="delete_hours") {
        await db.batch([db.prepare("DELETE FROM work_entries WHERE employee_id=? AND branch_id=? AND work_on=?").bind(viewer.id,branchId,body.workOn),audit("hours.deleted",id,{workOn:body.workOn,branchId})]);
        return Response.json({ok:true});
      }
      if(!Number.isInteger(body.minutes)||Number(body.minutes)<1||Number(body.minutes)>1440||body.note!==undefined&&(typeof body.note!=="string"||body.note.length>300))return Response.json({error:"Ingresá entre 1 minuto y 24 horas; la nota puede tener hasta 300 caracteres."},{status:400});
      const [result]=await db.batch([
        db.prepare(`INSERT INTO work_entries (id,employee_id,branch_id,work_on,minutes,work_role,note,created_at,updated_at)
          SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT coalesce(sum(minutes),0) FROM work_entries WHERE employee_id=? AND work_on=? AND branch_id<>?)+?<=1440
          ON CONFLICT(employee_id,branch_id,work_on) DO UPDATE SET minutes=excluded.minutes,note=excluded.note,updated_at=excluded.updated_at RETURNING id`)
          .bind(id,viewer.id,branchId,body.workOn,body.minutes,viewer.role,body.note??"",now,now,viewer.id,body.workOn,branchId,body.minutes),
        audit("hours.saved",id,{workOn:body.workOn,branchId,minutes:body.minutes}),
      ]);
      if(!result.results.length)return Response.json({error:"El total del día entre todas tus sedes no puede superar 24 horas."},{status:400});
      return Response.json({ok:true});
    }
    if(!can(viewer.role,"payroll.manage"))return Response.json({error:"Solo el encargado y el administrador general pueden configurar sueldos."},{status:403});
    if(body.action==="commission") {
      if(!isPeriod(body.period)||!Number.isInteger(body.commissionBps)||Number(body.commissionBps)<0||Number(body.commissionBps)>10000)return Response.json({error:"Elegí un mes y un porcentaje entre 0 y 100."},{status:400});
      const id=`${branchId}:${body.period}`;
      await db.batch([db.prepare(`INSERT INTO payroll_month_settings (id,branch_id,period,commission_bps,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(branch_id,period) DO UPDATE SET commission_bps=excluded.commission_bps,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).bind(id,branchId,body.period,body.commissionBps,viewer.id,now,now),audit("commission.configured",id,{branchId,period:body.period,commissionBps:body.commissionBps})]);
      return Response.json({ok:true});
    }
    if(typeof body.employeeId!=="string")return Response.json({error:"Seleccioná un empleado."},{status:400});
    const employee=await db.prepare("SELECT id,role,branch_scope AS branchScope FROM employees WHERE id=?").bind(body.employeeId).first<{id:string;role:string;branchScope:string}>();
    const role=employee?normalizeRole(employee.role):null;
    if(!employee||!role||role==="admin")return Response.json({error:"No se encontró el empleado."},{status:404});
    const assigned=hasBranchAccess(employeeScope(role,employee.branchScope),branchId);
    if(body.action==="rate") {
      if(!assigned)return Response.json({error:"El empleado no tiene esa sede asignada."},{status:403});
      if(role==="branch_manager"&&viewer.role!=="admin")return Response.json({error:"Solo el administrador general fija el valor hora de los encargados/coordinadores."},{status:403});
      if(!isDate(body.effectiveFrom)||!Number.isSafeInteger(body.amountCents)||Number(body.amountCents)<1||Number(body.amountCents)>100000000)return Response.json({error:"Ingresá la fecha de vigencia y un valor hora válido en pesos."},{status:400});
      const id=`${employee.id}:${branchId}:${body.effectiveFrom}`;
      await db.batch([db.prepare(`INSERT INTO hourly_rates (id,employee_id,branch_id,effective_from,amount_cents,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(employee_id,branch_id,effective_from) DO UPDATE SET amount_cents=excluded.amount_cents,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
        .bind(id,employee.id,branchId,body.effectiveFrom,body.amountCents,viewer.id,now,now),audit("rate.configured",id,{employeeId:employee.id,branchId,effectiveFrom:body.effectiveFrom,amountCents:body.amountCents})]);
      return Response.json({ok:true});
    }
    if(body.action==="presentism") {
      if(!isPeriod(body.period)||body.period>today.slice(0,7)||typeof body.eligible!=="boolean")return Response.json({error:"Elegí un mes hasta el actual e indicá si corresponde presentismo."},{status:400});
      const teacherWork=await db.prepare("SELECT id FROM work_entries WHERE employee_id=? AND branch_id=? AND work_role='teacher' AND substr(work_on,1,7)=? UNION ALL SELECT id FROM work_shift_records WHERE employee_id=? AND branch_id=? AND status IN ('confirmed','validated') AND substr(work_on,1,7)=? LIMIT 1").bind(employee.id,branchId,body.period,employee.id,branchId,body.period).first();
      if(!teacherWork)return Response.json({error:"El empleado no tiene horas de profesor registradas en esta sede y mes."},{status:400});
      if(employee.id===viewer.id)return Response.json({error:"Otro encargado o el administrador general debe confirmar tu presentismo."},{status:403});
      const id=`${employee.id}:${branchId}:${body.period}`;
      await db.batch([db.prepare(`INSERT INTO payroll_bonuses (id,employee_id,branch_id,period,eligible,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(employee_id,branch_id,period) DO UPDATE SET eligible=excluded.eligible,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
        .bind(id,employee.id,branchId,body.period,body.eligible?1:0,viewer.id,now,now),audit("presentism.confirmed",id,{employeeId:employee.id,branchId,period:body.period,eligible:body.eligible})]);
      return Response.json({ok:true});
    }
    return Response.json({error:"Acción inválida."},{status:400});
  }catch{console.error("payroll_save_failed");return Response.json({error:"No se pudo guardar. Tus datos siguen en pantalla."},{status:500});}
}
