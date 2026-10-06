import {getRawDb} from "@/db";
import {getCurrentEmployee} from "@/lib/auth";
import {rejectUnsafeRequest} from "@/lib/auth-security";
import {effectiveBranchFilter} from "@/lib/branch-filter";
import {defaultBranches} from "@/lib/branch-catalog";
import {can,employeeScope,hasBranchAccess,scopeBranchIds} from "@/lib/permissions";
import {argentinaDay,daysInMonth,isDate,isPeriod} from "@/lib/member-analytics";
import {readChanges,readLocations,readSchedules,readOverrides,readRecords} from "@/lib/work-schedule-db";
import {activeSchedule,distanceMeters,localHour,plannedHours,ranges,sameHours,sortedHours,turnState,validDailySlots,validWeeklySlots,weekday,type CalendarDay,type DayPatch,type WorkSchedule,type DayOverride} from "@/lib/work-schedule";

async function access(){const viewer=await getCurrentEmployee();if(!viewer)return {error:Response.json({error:"Ingresá con tu cuenta."},{status:401})};if(!can(viewer.role,"payroll.self"))return {error:Response.json({error:"Sin acceso a horarios."},{status:403})};return {viewer};}
async function staff(){return (await getRawDb().prepare("SELECT id,display_name AS name,branch_scope AS branchScope,active FROM employees WHERE role='teacher'").all<{id:string;name:string;branchScope:string;active:number}>()).results;}
const touches=(c:{workOn:string;patch:DayPatch[]},day:string)=>c.workOn===day||c.patch.some(p=>p.workOn===day);
export async function GET(request:Request){
 const auth=await access();if(auth.error)return auth.error;const viewer=auth.viewer!,params=new URL(request.url).searchParams,period=params.get("period")??argentinaDay().slice(0,7),team=params.get("scope")==="team";
 if(!isPeriod(period))return Response.json({error:"Elegí un mes válido."},{status:400});if(team&&!can(viewer.role,"payroll.manage"))return Response.json({error:"Solo coordinadores y administradores pueden ver los horarios del equipo."},{status:403});
 const selected=effectiveBranchFilter(params.get("branch"),viewer.branchScope);if("error" in selected)return Response.json({error:selected.error},{status:selected.status});
 try{
  const [people,schedules,overrides,changes,records,locations,legacy]=await Promise.all([staff(),readSchedules(team?undefined:viewer.id),readOverrides(team?undefined:viewer.id),readChanges(team?undefined:viewer.id),readRecords(team?undefined:viewer.id),readLocations(),getRawDb().prepare("SELECT employee_id AS employeeId,branch_id AS branchId,work_on AS workOn,minutes FROM work_entries WHERE substr(work_on,1,7)=? AND (?=1 OR employee_id=?)").bind(period,team?1:0,viewer.id).all<{employeeId:string;branchId:string;workOn:string;minutes:number}>()]);
  const now=new Date(),today=argentinaDay(now),hour=localHour(now),employees=people.filter(e=>e.active&&(team||e.id===viewer.id)).map(e=>({id:e.id,name:e.name,branchIds:scopeBranchIds(employeeScope("teacher",e.branchScope)).filter(b=>selected.branchIds.includes(b))})).filter(e=>e.branchIds.length),ids=new Set(employees.map(e=>e.id));
  const visible=(e:{employeeId:string;branchId:string})=>ids.has(e.employeeId)&&selected.branchIds.includes(e.branchId);const days:CalendarDay[]=[];
  for(const employee of employees)for(const branchId of employee.branchIds)for(let d=1;d<=daysInMonth(period);d++){
   const workOn=`${period}-${String(d).padStart(2,"0")}`,slots=plannedHours(schedules,overrides,employee.id,branchId,workOn),daily=records.filter(r=>r.employeeId===employee.id&&r.branchId===branchId&&r.workOn===workOn),old=legacy.results.find(e=>e.employeeId===employee.id&&e.branchId===branchId&&e.workOn===workOn),pending=changes.find(c=>c.employeeId===employee.id&&c.branchId===branchId&&c.status==="pending"&&touches(c,workOn))??null;
   const turns=ranges(slots).map(({start,end})=>{const record=daily.find(r=>r.startHour===start&&r.endHour===end&&r.status!=="cancelled"),status=record?.status??turnState(workOn,start,end,today,hour);return {start,end,status,canConfirm:status==="pending_confirmation"&&!pending&&!old&&locations.some(l=>l.branchId===branchId)};});
   for(const record of daily.filter(r=>r.status==="cancelled"&&!turns.some(t=>t.start===r.startHour&&t.end===r.endHour)))turns.push({start:record.startHour,end:record.endHour,status:"cancelled",canConfirm:false});
   days.push({employeeId:employee.id,branchId,workOn,slots,turns,plannedMinutes:slots.length*60,confirmedMinutes:daily.filter(r=>["confirmed","validated"].includes(r.status)).reduce((s,r)=>s+(r.endHour-r.startHour)*60,0)+(old?.minutes??0),legacyMinutes:old?.minutes??0,pending});
  }
  return Response.json({period,today,serverTime:now.toISOString(),employees,branches:defaultBranches.filter(b=>selected.branchIds.includes(b.id)).map(b=>({id:b.id,name:b.name,location:locations.find(l=>l.branchId===b.id)??null})),schedules:schedules.filter(visible),changes:changes.filter(c=>visible(c)&&(c.workOn.startsWith(period)||c.patch.some(p=>p.workOn.startsWith(period))||c.status==="pending")),days},{headers:{"Cache-Control":"no-store"}});
 }catch(e){console.error("schedule_read_failed",String(e));return Response.json({error:"No se pudo cargar el calendario."},{status:500});}
}
export async function POST(request:Request){
 const unsafe=rejectUnsafeRequest(request);if(unsafe)return unsafe;const auth=await access();if(auth.error)return auth.error;const viewer=auth.viewer!;
 let body:Record<string,unknown>;try{body=await request.json();}catch{return Response.json({error:"Datos inválidos."},{status:400});}
 const fail=(error:string,status=400)=>Response.json({error},{status});
 if(!body||typeof body.branchId!=="string"||!hasBranchAccess(viewer.branchScope,body.branchId))return fail("Elegí una sede autorizada.",403);
 const db=getRawDb(),branchId=body.branchId,now=new Date(),stamp=now.toISOString(),today=argentinaDay(now),manage=can(viewer.role,"payroll.manage");
 const audit=(action:string,id:string,details:unknown)=>db.prepare("INSERT INTO audit_logs (id,employee_id,action,entity_type,entity_id,metadata_json,created_at,updated_at) VALUES (?,?,?,'work_schedule',?,?,?,?)").bind(crypto.randomUUID(),viewer.id,action,id,JSON.stringify(details),stamp,stamp);
 try{
  const adminAction=["schedule","edit_day","decide","validate","absence"].includes(String(body.action));
  if(adminAction&&!manage)return fail("Solo los coordinadores y administradores generales pueden modificar cronogramas o aprobar cambios.",403);
  let employeeId=adminAction?body.employeeId:viewer.id;
  if(body.action==="decide"){const c=await db.prepare("SELECT employee_id AS employeeId FROM work_shift_changes WHERE id=? AND branch_id=?").bind(typeof body.requestId==="string"?body.requestId:"",branchId).first<{employeeId:string}>();employeeId=c?.employeeId;}
  if(!adminAction&&(viewer.role!=="teacher"||body.employeeId!==undefined&&body.employeeId!==viewer.id))return fail("Cada profesor gestiona sus propios turnos.",403);
  const found=(await staff()).find(e=>e.id===employeeId&&e.active&&hasBranchAccess(employeeScope("teacher",e.branchScope),branchId));if(!found)return fail("El profesor no tiene esa sede asignada.",403);const employee=found;employeeId=employee.id;
  const [schedules,overrides,changes,records]=await Promise.all([readSchedules(employee.id),readOverrides(employee.id),readChanges(employee.id),readRecords(employee.id)]);
  const slotsOn=(day:string,b=branchId)=>plannedHours(schedules,overrides,employee.id,b,day);
  const pendingOn=(day:string)=>changes.find(c=>c.branchId===branchId&&c.status==="pending"&&touches(c,day));
  const legacyOn=async(day:string)=>!!await db.prepare("SELECT id FROM work_entries WHERE employee_id=? AND branch_id=? AND work_on=?").bind(employee.id,branchId,day).first();
  function overlap(patch:DayPatch[]){const otherBranches=new Set([...schedules,...overrides].filter(s=>s.branchId!==branchId).map(s=>s.branchId));return patch.some(p=>[...otherBranches].some(b=>slotsOn(p.workOn,b).some(h=>p.slots.includes(h))));}
  function patchValid(value:unknown):value is DayPatch[]{return Array.isArray(value)&&value.length>=1&&value.length<=2&&new Set(value.map(p=>p?.workOn)).size===value.length&&value.every(p=>p&&isDate(p.workOn)&&validDailySlots(p.slots,weekday(p.workOn))&&validDailySlots(p.previousSlots,weekday(p.workOn)));}
  function patchOps(patch:DayPatch[],gateId?:string){
   const gate=gateId?"EXISTS(SELECT 1 FROM work_shift_changes WHERE id=? AND status='approved' AND decided_at=?)":"1=1",gateArgs=gateId?[gateId,stamp]:[];
   return patch.flatMap(p=>[
    db.prepare(`INSERT INTO work_day_overrides (id,employee_id,branch_id,work_on,slots_json,updated_by,created_at,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE ${gate} ON CONFLICT(employee_id,branch_id,work_on) DO UPDATE SET slots_json=excluded.slots_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).bind(`${employee.id}:${branchId}:${p.workOn}`,employee.id,branchId,p.workOn,JSON.stringify(sortedHours(p.slots)),viewer.id,stamp,stamp,...gateArgs),
    db.prepare(`UPDATE work_shift_records SET status='cancelled',updated_by=?,note='Horario modificado por coordinación',updated_at=? WHERE employee_id=? AND branch_id=? AND work_on=? AND ${gate} AND NOT EXISTS(SELECT 1 FROM json_each(?) r WHERE json_extract(r.value,'$.start')=start_hour AND json_extract(r.value,'$.end')=end_hour)`).bind(viewer.id,stamp,employee.id,branchId,p.workOn,...gateArgs,JSON.stringify(ranges(p.slots)))
   ]);
  }
  function recordOp(day:string,start:number,end:number,status:string,note:string,gateId?:string){const gate=gateId?"EXISTS(SELECT 1 FROM work_shift_changes WHERE id=? AND status='approved' AND decided_at=?)":"1=1";return db.prepare(`INSERT INTO work_shift_records (id,employee_id,branch_id,work_on,start_hour,end_hour,status,confirmed_at,updated_by,note,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE ${gate} ON CONFLICT(employee_id,branch_id,work_on,start_hour,end_hour) DO UPDATE SET status=excluded.status,confirmed_at=excluded.confirmed_at,updated_by=excluded.updated_by,note=excluded.note,updated_at=excluded.updated_at`).bind(`${employee.id}:${branchId}:${day}:${start}:${end}`,employee.id,branchId,day,start,end,status,status==="validated"?stamp:null,viewer.id,note,stamp,stamp,...(gateId?[gateId,stamp]:[]));}
  if(body.action==="schedule"){
   if(!isDate(body.effectiveFrom)||body.effectiveFrom<today||!validWeeklySlots(body.slots))return fail("Elegí una vigencia desde hoy y bloques de lunes a viernes de 07 a 21, o sábado de 09 a 12.");
   const effectiveFrom=body.effectiveFrom,slots=[...body.slots].sort((a,b)=>a.day-b.day||a.hour-b.hour),id=`${employee.id}:${branchId}:${effectiveFrom}`,candidate={id,employeeId:employee.id,branchId,effectiveFrom,slots,updatedAt:stamp},all=[...schedules.filter(s=>s.id!==id),candidate];
   for(const date of [...new Set([effectiveFrom,...all.filter(s=>s.effectiveFrom>=effectiveFrom).map(s=>s.effectiveFrom)])]){
    if(activeSchedule(all,employee.id,branchId,date)?.id!==id)continue;
    for(const b of new Set(all.filter(s=>s.branchId!==branchId).map(s=>s.branchId))){const other=activeSchedule(all,employee.id,b,date);if(other?.slots.some(s=>slots.some(v=>v.day===s.day&&v.hour===s.hour)))return fail("El profesor ya tiene horas asignadas en otra sede en ese horario.",409);}
   }
   const next=all.filter(s=>s.branchId===branchId&&s.effectiveFrom>effectiveFrom).sort((a,b)=>a.effectiveFrom.localeCompare(b.effectiveFrom))[0]?.effectiveFrom??"2100-01-01";
   const old=await db.prepare("SELECT work_on AS workOn FROM work_entries WHERE employee_id=? AND branch_id=? AND work_on>=? AND work_on<?").bind(employee.id,branchId,effectiveFrom,next).all<{workOn:string}>();
   if(old.results.some(e=>plannedHours(all,overrides,employee.id,branchId,e.workOn).length))return fail("Ya hay horas manuales históricas en esas fechas. Elegí una vigencia posterior para evitar duplicarlas.",409);
   // Also check dated exceptions at other branches, not only weekly patterns.
   for(const o of overrides.filter(o=>o.workOn>=effectiveFrom&&o.workOn<next&&o.branchId!==branchId)){if(plannedHours(all,overrides,employee.id,branchId,o.workOn).some(h=>o.slots.includes(h)))return fail("El cronograma se superpone con un cambio aprobado en otra sede.",409);}
   const weeklyRanges=[1,2,3,4,5,6].flatMap(day=>ranges(slots.filter(s=>s.day===day).map(s=>s.hour)).map(r=>({...r,day})));
   await db.batch([db.prepare("INSERT INTO work_schedules (id,employee_id,branch_id,effective_from,slots_json,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(employee_id,branch_id,effective_from) DO UPDATE SET slots_json=excluded.slots_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at").bind(id,employee.id,branchId,effectiveFrom,JSON.stringify(slots),viewer.id,stamp,stamp),db.prepare("UPDATE work_shift_records SET status='cancelled',updated_by=?,note='Cronograma modificado por coordinación',updated_at=? WHERE employee_id=? AND branch_id=? AND work_on>=? AND work_on<? AND NOT EXISTS(SELECT 1 FROM work_day_overrides o WHERE o.employee_id=work_shift_records.employee_id AND o.branch_id=work_shift_records.branch_id AND o.work_on=work_shift_records.work_on) AND NOT EXISTS(SELECT 1 FROM json_each(?) r WHERE json_extract(r.value,'$.day')=CAST(strftime('%w',work_on) AS INTEGER) AND json_extract(r.value,'$.start')=start_hour AND json_extract(r.value,'$.end')=end_hour)").bind(viewer.id,stamp,employee.id,branchId,effectiveFrom,next,JSON.stringify(weeklyRanges)),audit("schedule.configured",id,{employeeId:employee.id,branchId,effectiveFrom,slots})]);return Response.json({ok:true});
  }
  if(body.action==="edit_day"||body.action==="request"){
   const kind=body.action==="request"&&body.kind==="review"?"review":"change";
   if(typeof body.reason!=="string"||body.reason.trim().length<3||body.reason.length>300)return fail("Indicá el motivo (entre 3 y 300 caracteres).");
   if(!patchValid(body.patch))return fail("Seleccioná días y horas dentro de las franjas permitidas.");const patch=body.patch;
   if(patch.some(p=>!sameHours(p.previousSlots,slotsOn(p.workOn))))return fail("El horario cambió. Actualizá el calendario.",409);
   if(patch.some(p=>pendingOn(p.workOn)))return fail("Ya hay una solicitud pendiente para uno de esos días. Resolvela primero.",409);
   if(await Promise.all(patch.map(p=>legacyOn(p.workOn))).then(v=>v.some(Boolean)))return fail("Ese día contiene una carga manual histórica. El nuevo calendario empieza con jornadas sin cargas anteriores.",409);
   if(overlap(patch))return fail("El horario se superpone con un turno de otra sede.",409);
   if(kind==="review"){
    if(patch.length!==1||!sameHours(patch[0].slots,patch[0].previousSlots)||!ranges(patch[0].slots).some(r=>r.start===body.start&&r.end===body.end)||turnState(patch[0].workOn,Number(body.start),Number(body.end),today,localHour(now))==="scheduled"||turnState(patch[0].workOn,Number(body.start),Number(body.end),today,localHour(now))==="in_progress")return fail("Solo podés solicitar revisión de un turno que ya terminó.");
    if(records.some(r=>r.branchId===branchId&&r.workOn===patch[0].workOn&&r.startHour===body.start&&r.endHour===body.end&&["confirmed","validated"].includes(r.status)))return fail("Ese turno ya está reconocido.",409);
   }else if(patch.every(p=>sameHours(p.slots,p.previousSlots)))return fail("El horario propuesto es igual al actual.");
   if(body.action==="edit_day"){await db.batch([...patchOps(patch),audit("schedule.day_edited",employee.id,{branchId,patch,reason:body.reason})]);return Response.json({ok:true});}
   const id=crypto.randomUUID();await db.batch([db.prepare("INSERT INTO work_shift_changes (id,employee_id,branch_id,work_on,kind,patch_json,shift_start,shift_end,reason,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?)").bind(id,employee.id,branchId,patch[0].workOn,kind,JSON.stringify(patch),kind==="review"?body.start:null,kind==="review"?body.end:null,body.reason.trim(),stamp,stamp),audit("shift_change.requested",id,{branchId,kind,patch})]);return Response.json({ok:true});
  }
  if(body.action==="decide"){
   const change=changes.find(c=>c.id===body.requestId&&c.branchId===branchId&&c.status==="pending");if(!change)return fail("La solicitud ya fue resuelta.",409);
   if(!["approved","rejected"].includes(String(body.decision))||typeof body.decisionNote!=="string"||body.decisionNote.length>300)return fail("Revisá la decisión y la nota.");
   if(employee.id===viewer.id)return fail("Otro coordinador debe resolver tu solicitud.",403);
   if(body.decision==="approved"&&(change.patch.some(p=>!sameHours(p.previousSlots,slotsOn(p.workOn)))||overlap(change.patch)))return fail("El horario cambió o hay una superposición. Rechazá la solicitud para que se vuelva a enviar.",409);
   const operations=[db.prepare("UPDATE work_shift_changes SET status=?,decided_by=?,decision_note=?,decided_at=?,updated_at=? WHERE id=? AND status='pending' RETURNING id").bind(body.decision,viewer.id,body.decisionNote,stamp,stamp,change.id)];
   if(body.decision==="approved"){if(change.kind==="review")operations.push(recordOp(change.workOn,change.shiftStart!,change.shiftEnd!,"validated",`Revisión aprobada: ${change.reason}`,change.id));else operations.push(...patchOps(change.patch,change.id));}
   operations.push(audit("shift_change.decided",change.id,{decision:body.decision,branchId,employeeId:employee.id}));const [result]=await db.batch(operations);if(!result.results.length)return fail("La solicitud ya fue resuelta.",409);return Response.json({ok:true});
  }
  if(!isDate(body.workOn))return fail("Elegí un día válido.");const workOn=body.workOn,slots=slotsOn(workOn),turn=ranges(slots).find(r=>r.start===body.start&&r.end===body.end);if(!turn)return fail("El turno cambió o no existe. Actualizá el calendario.",409);
  if(pendingOn(workOn))return fail("Hay una solicitud pendiente para ese día. Primero debe resolverse.",409);
  if(await legacyOn(workOn))return fail("Ese día ya tiene horas manuales registradas.",409);
  const state=turnState(workOn,turn.start,turn.end,today,localHour(now)),id=`${employee.id}:${branchId}:${workOn}:${turn.start}:${turn.end}`;
  if(body.action==="validate"||body.action==="absence"){
   if(state==="scheduled"||state==="in_progress")return fail("El turno todavía no terminó.");if(typeof body.reason!=="string"||body.reason.trim().length<3||body.reason.length>300)return fail("Indicá el motivo de la revisión.");
   await db.batch([recordOp(workOn,turn.start,turn.end,body.action==="validate"?"validated":"absent",body.reason),audit("shift.reviewed",id,{status:body.action,reason:body.reason})]);return Response.json({ok:true});
  }
  if(body.action!=="confirm")return fail("Acción inválida.");if(state!=="pending_confirmation")return fail("Confirmá desde el fin del turno hasta una hora después. Fuera de ese plazo, solicitá una revisión.");
  const record=records.find(r=>r.id===id);if(record&&record.status!=="cancelled")return fail("Este turno ya fue confirmado o resuelto por coordinación.",409);
  const location=(await readLocations()).find(l=>l.branchId===branchId);if(!location)return fail("El coordinador todavía debe configurar la ubicación de la sede.",409);
  const p=body.position as {latitude?:number;longitude?:number;accuracy?:number;timestamp?:number}|undefined;
  if(!p||typeof p.latitude!=="number"||!Number.isFinite(p.latitude)||Math.abs(p.latitude)>90||typeof p.longitude!=="number"||!Number.isFinite(p.longitude)||Math.abs(p.longitude)>180||typeof p.accuracy!=="number"||!Number.isFinite(p.accuracy)||p.accuracy<0||p.accuracy>Math.min(location.radiusMeters,100)||typeof p.timestamp!=="number"||!Number.isFinite(p.timestamp)||now.getTime()-p.timestamp>120000||p.timestamp-now.getTime()>10000)return fail("Necesitamos una ubicación reciente y precisa. Activá la ubicación precisa del celular y reintentá.");
  const distance=distanceMeters(p.latitude,p.longitude,location.latitude,location.longitude);if(distance>location.radiusMeters)return fail(`Estás a ${Math.round(distance)} m de la sede. Acercate al gimnasio para confirmar (radio ${location.radiusMeters} m).`,403);
  const schedule=activeSchedule(schedules,employee.id,branchId,workOn),override=overrides.find(o=>o.branchId===branchId&&o.workOn===workOn);
  const [result]=await db.batch([db.prepare(`INSERT INTO work_shift_records (id,employee_id,branch_id,work_on,start_hour,end_hour,status,confirmed_at,distance_meters,accuracy_meters,updated_by,note,created_at,updated_at)
   SELECT ?,?,?,?,?,?,'confirmed',?,?,?,?, 'Confirmado con ubicación',?,? WHERE coalesce((SELECT updated_at FROM work_schedules WHERE employee_id=? AND branch_id=? AND effective_from<=? ORDER BY effective_from DESC LIMIT 1),'')=?
   AND coalesce((SELECT updated_at FROM work_day_overrides WHERE employee_id=? AND branch_id=? AND work_on=?),'')=?
   AND NOT EXISTS(SELECT 1 FROM work_shift_changes c WHERE c.employee_id=? AND c.branch_id=? AND c.status='pending' AND (c.work_on=? OR EXISTS(SELECT 1 FROM json_each(c.patch_json) p WHERE json_extract(p.value,'$.workOn')=?)))
   ON CONFLICT(employee_id,branch_id,work_on,start_hour,end_hour) DO UPDATE SET status='confirmed',confirmed_at=excluded.confirmed_at,distance_meters=excluded.distance_meters,accuracy_meters=excluded.accuracy_meters,updated_by=excluded.updated_by,note=excluded.note,updated_at=excluded.updated_at WHERE work_shift_records.status='cancelled' RETURNING id`).bind(id,employee.id,branchId,workOn,turn.start,turn.end,stamp,Math.round(distance),Math.round(p.accuracy),viewer.id,stamp,stamp,employee.id,branchId,workOn,schedule?.updatedAt??"",employee.id,branchId,workOn,override?.updatedAt??"",employee.id,branchId,workOn,workOn),db.prepare("INSERT INTO audit_logs (id,employee_id,action,entity_type,entity_id,metadata_json,created_at,updated_at) SELECT ?,?,'shift.confirmed','work_schedule',?,?,?,? WHERE EXISTS(SELECT 1 FROM work_shift_records WHERE id=? AND confirmed_at=?)").bind(crypto.randomUUID(),viewer.id,id,JSON.stringify({branchId,workOn,start:turn.start,end:turn.end,distanceMeters:Math.round(distance),accuracyMeters:Math.round(p.accuracy)}),stamp,stamp,id,stamp)]);
  if(!result.results.length)return fail("El turno ya fue confirmado o su horario cambió. Actualizá el calendario.",409);return Response.json({ok:true});
 }catch(e){console.error("schedule_save_failed",String(e));return fail("No se pudo guardar. Actualizá el calendario y volvé a intentar.",500);}
}
