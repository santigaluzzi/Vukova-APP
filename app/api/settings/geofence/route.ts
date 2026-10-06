import {getRawDb} from "@/db";
import {getCurrentEmployee} from "@/lib/auth";
import {rejectUnsafeRequest} from "@/lib/auth-security";
import {defaultBranches} from "@/lib/branch-catalog";
import {hasBranchAccess,scopeBranchIds} from "@/lib/permissions";

type Fence={branchId:string;address:string;latitude:number|null;longitude:number|null;radiusMeters:number};
const manager=(role:string)=>role==="admin"||role==="branch_manager";
async function access(){const viewer=await getCurrentEmployee();if(!viewer)return {error:Response.json({error:"Ingresá con tu cuenta."},{status:401})};if(!manager(viewer.role))return {error:Response.json({error:"Solo coordinadores y administradores generales pueden configurar el geofencing."},{status:403})};return {viewer};}
export async function GET(){const auth=await access();if(auth.error)return auth.error;try{const fences=(await getRawDb().prepare("SELECT branch_id AS branchId,address,latitude,longitude,radius_meters AS radiusMeters FROM branch_geofences").all<Fence>()).results;return Response.json({branches:defaultBranches.filter(b=>scopeBranchIds(auth.viewer!.branchScope).includes(b.id)).map(b=>({...b,...fences.find(f=>f.branchId===b.id)}))},{headers:{"Cache-Control":"no-store"}});}catch(e){console.error("geofence_read_failed",String(e));return Response.json({error:"No se pudo cargar la configuración."},{status:500});}}
export async function POST(request:Request){const unsafe=rejectUnsafeRequest(request);if(unsafe)return unsafe;const auth=await access();if(auth.error)return auth.error;const viewer=auth.viewer!;
 let body:Record<string,unknown>;try{body=await request.json();}catch{return Response.json({error:"Datos inválidos."},{status:400});}
 const fail=(error:string,status=400)=>Response.json({error},{status});
 if(typeof body.branchId!=="string"||!hasBranchAccess(viewer.branchScope,body.branchId))return fail("Sede no autorizada.",403);
 if(typeof body.address!=="string"||body.address.trim().length<8||body.address.length>250)return fail("Ingresá una dirección válida.");
 if(!Number.isInteger(body.radiusMeters)||Number(body.radiusMeters)<30||Number(body.radiusMeters)>500)return fail("Elegí un radio de 30 a 500 metros.");
 const hasPoint=body.latitude!==undefined||body.longitude!==undefined;
 if(hasPoint&&(typeof body.latitude!=="number"||!Number.isFinite(body.latitude)||Math.abs(body.latitude)>90||typeof body.longitude!=="number"||!Number.isFinite(body.longitude)||Math.abs(body.longitude)>180||typeof body.accuracy!=="number"||!Number.isFinite(body.accuracy)||body.accuracy>100||body.accuracy<0||typeof body.timestamp!=="number"||Math.abs(Date.now()-body.timestamp)>120000))return fail("Obtené una ubicación reciente y precisa desde la sede.");
 const db=getRawDb(),now=new Date().toISOString(),address=body.address.trim();
 try{const prior=await db.prepare("SELECT address,latitude,longitude FROM branch_geofences WHERE branch_id=?").bind(body.branchId).first<{address:string;latitude:number|null;longitude:number|null}>();if(!prior)return fail("Sede sin configuración inicial.",409);
 await db.batch([db.prepare("UPDATE branch_geofences SET address=?,radius_meters=?,latitude=CASE WHEN ? THEN ? WHEN address<>? THEN NULL ELSE latitude END,longitude=CASE WHEN ? THEN ? WHEN address<>? THEN NULL ELSE longitude END,updated_by=?,updated_at=? WHERE branch_id=?").bind(address,body.radiusMeters,hasPoint?1:0,hasPoint?body.latitude:null,address,hasPoint?1:0,hasPoint?body.longitude:null,address,viewer.id,now,body.branchId),db.prepare("INSERT INTO audit_logs (id,employee_id,action,entity_type,entity_id,metadata_json,created_at,updated_at) VALUES (?,?,'geofence.configured','branch',?,?,?,?)").bind(crypto.randomUUID(),viewer.id,body.branchId,JSON.stringify({address,radiusMeters:body.radiusMeters,pointUpdated:hasPoint}),now,now)]);return Response.json({ok:true,pointReady:hasPoint||(prior.address===address&&prior.latitude!==null&&prior.longitude!==null)});
 }catch(e){console.error("geofence_save_failed",String(e));return fail("No se pudo guardar la sede.",500);}
}
