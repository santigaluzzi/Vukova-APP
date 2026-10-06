import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {createHash,randomBytes} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import path from "node:path";

const require=createRequire(import.meta.url);
const {Miniflare}=createRequire(require.resolve("wrangler/package.json"))("miniflare");
const root=path.resolve(import.meta.dirname,".."), serverRoot=path.join(root,"dist/server");
const files=readdirSync(serverRoot,{recursive:true}).filter(n=>n.endsWith(".js")&&n!=="index.js");
const setupKey=randomBytes(32).toString("base64url"),password=randomBytes(24).toString("base64url");
const hash=x=>createHash("sha256").update(x).digest("hex");
const worker=new Miniflare({modulesRoot:serverRoot,modules:["index.js",...files].map(name=>({type:"ESModule",path:path.join(serverRoot,name)})),compatibilityDate:"2026-05-15",compatibilityFlags:["nodejs_compat"],d1Databases:{DB:"attendance-multi-test"},bindings:{VUKOVA_SETUP_TOKEN_SHA256:hash(setupKey)}});
async function call(route,{body,cookie,token}={}) {
  const response=await worker.dispatchFetch(`https://vukova.test${route}`,{method:body===undefined?"GET":"POST",headers:{"Content-Type":"application/json",Origin:"https://vukova.test",...(cookie?{Cookie:cookie}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,body:await response.json(),cookie:response.headers.get("set-cookie")?.split(";")[0]};
}
try {
  const db=await worker.getD1Database("DB");
  for(const name of readdirSync(path.join(root,"drizzle")).filter(n=>n.endsWith(".sql")).sort())
    await db.batch(readFileSync(path.join(root,"drizzle",name),"utf8").split("--> statement-breakpoint").map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
  const admin=await call("/api/auth/setup",{body:{setupKey,displayName:"Admin",username:"attendance.admin",password,confirmPassword:password}});
  assert.equal(admin.status,201);
  const prepared=await call("/api/settings/sheets",{cookie:admin.cookie,body:{scope:"attendance"}});
  assert.equal(prepared.status,200);
  new Function(prepared.body.script);
  const token=JSON.parse(prepared.body.script.match(/const VUKOVA_CLAVE = (.+);/)[1]);
  const config=await call("/api/imports/sheets?kind=attendance",{token});
  assert.equal(config.status,200);
  assert.deepEqual(config.body.sources.map(s=>s.branchId),["branch-acassuso","branch-victoria","branch-delta","branch-olivos","branch-vilo"]);
  const upgraded=await call("/api/settings/sheets",{cookie:admin.cookie,body:{scope:"attendance",reuse:true}});
  assert.equal(upgraded.status,200);
  assert.equal(JSON.parse(upgraded.body.script.match(/const VUKOVA_CLAVE = (.+);/)[1]),"");
  new Function(upgraded.body.script);
  const victoria={kind:"attendance",spreadsheetId:config.body.sources[1].spreadsheetId,branchId:"branch-victoria",sheetId:101,sheetName:"SEPTIEMBRE 26",year:2026,month:9,rows:[[],[],["ALUMNOS","ASISTENCIAS MENSUALES","","1","2"],["ANA PRUEBA","","","P","p"]]};
  const delta={...victoria,spreadsheetId:config.body.sources[2].spreadsheetId,branchId:"branch-delta",sheetId:102,sheetName:"SEPT 26",rows:[[],[],["APELLIDO Y NOMBRE","ASISTENCIAS MENSUALES","CONTACTO","1"],["ANA PRUEBA","","teléfono privado","P"]]};
  const olivos={...victoria,spreadsheetId:config.body.sources[3].spreadsheetId,branchId:"branch-olivos",sheetId:103,sheetName:"SEPTIEMBRE 2026",rows:[[],[],["","","1","2","31"],["ANA PRUEBA","","1","",""]]};
  const vilo={...victoria,spreadsheetId:config.body.sources[4].spreadsheetId,branchId:"branch-vilo",sheetId:500813021,rows:[[],[],["DIAS","","1","2","3","31"],["ANA PRUEBA","999","1","1","VACACIONES",""],["Ana Prueba ","999","1","","",""] ,["OTRO SOCIO","999","","","1",""]]};
  for(const payload of [victoria,delta,olivos,vilo]) {
    const result=await call("/api/imports/sheets",{token,body:payload});
    assert.equal(result.status,200,JSON.stringify(result));
  }
  assert.equal((await call("/api/imports/sheets",{token,body:{...delta,branchId:"branch-victoria"}})).status,400);
  assert.equal((await call("/api/imports/sheets",{token,body:{...delta,sheetName:"SEPTIEMBRE 2026"}})).status,200);
  assert.equal((await call("/api/imports/sheets",{token,body:{...delta,spreadsheetId:"otro"}})).status,400);
  assert.equal((await call("/api/imports/sheets",{token,body:vilo})).status,200,"Repeated delivery must not duplicate the visible snapshot.");
  assert.equal((await call("/api/imports/sheets",{token,body:{...vilo,branchId:"branch-olivos"}})).status,400);
  assert.equal((await call("/api/imports/sheets",{token,body:{...vilo,sheetName:"SEPTIEMBRE 25",year:2025}})).status,400);
  for(const [branch,total] of [["branch-victoria",2],["branch-delta",1],["branch-olivos",1],["branch-vilo",3]]) {
    const response=await call(`/api/attendance/sheets?analytics=1&branch=${branch}`,{cookie:admin.cookie});
    assert.equal(response.status,200,JSON.stringify(response));
    assert.equal(response.body.analytics.total,total);
    assert.equal(response.body.selected.sources.length,1);
  }
  const all=await call("/api/attendance/sheets?analytics=1&branch=all",{cookie:admin.cookie});
  assert.equal(all.status,200,JSON.stringify(all));
  assert.equal(all.body.analytics.total,7);
  assert.equal(all.body.analytics.people.filter(p=>p.displayName==="ANA PRUEBA").length,4,"Identical names at different branches remain separate until explicitly linked.");
  const correctedVilo={...vilo,rows:vilo.rows.map(row=>[...row])};
  correctedVilo.rows[3][3]="";
  assert.equal((await call("/api/imports/sheets",{token,body:correctedVilo})).status,200);
  assert.equal((await call("/api/attendance/sheets?analytics=1&branch=branch-vilo",{cookie:admin.cookie})).body.analytics.total,2,"Clearing a daily mark must remove the previous attendance.");
  const febVilo={...vilo,sheetId:94189668,sheetName:"FEBRERO 26´",month:2};
  assert.equal((await call("/api/imports/sheets",{token,body:febVilo})).status,200,"Vilo's trailing accent must not hide the February tab.");
  const juneVilo={...vilo,sheetId:610627990,sheetName:"JUNIO 26",month:6,rows:[[],[],["DIAS","","1","30","31"],["SOCIO JUNIO","999","1","1","1"]]};
  const juneResult=await call("/api/imports/sheets",{token,body:juneVilo});
  assert.equal(juneResult.status,200,JSON.stringify(juneResult));
  assert.equal(juneResult.body.records,2,"June 31 is excluded while valid dates still import.");
  assert.deepEqual(juneResult.body.warnings.invalidDays,[{sourceRow:4,name:"SOCIO JUNIO",day:31,marker:"1"}]);
  const juneReport=await call("/api/attendance/sheets?analytics=1&branch=branch-vilo&period=2026-06",{cookie:admin.cookie});
  assert.equal(juneReport.body.analytics.total,2);
  assert.equal(juneReport.body.selected.warnings.invalidDays[0].branchId,"branch-vilo");
  const febXRows=[[],[],["DIAS","",...Array.from({length:28},(_,i)=>String(i+1)),"X","X"],["SOCIO FEBRERO","",...Array(28).fill(""),"1",""]];
  febXRows[3][2]="1";febXRows[3][29]="1";
  const febXResult=await call("/api/imports/sheets",{token,body:{...febVilo,rows:febXRows}});
  assert.equal(febXResult.status,200,JSON.stringify(febXResult));
  assert.equal(febXResult.body.records,2,"Trailing X columns must not block valid February dates.");
  assert.equal(febXResult.body.warnings.invalidDays[0].day,29,"A mark in an unused X slot remains excluded and reviewable.");
  const interiorXRows=febXRows.map(r=>[...r]);interiorXRows[2][3]="X";
  assert.equal((await call("/api/imports/sheets",{token,body:{...febVilo,rows:interiorXRows}})).status,400,"Do not hide an unknown header within the actual calendar.");
  await db.prepare("INSERT INTO members (id,full_name,home_branch_id,status,service,created_at,updated_at) VALUES ('test-delta-ana','ANA PRUEBA','branch-delta','active','gym',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)").run();
  const linked=await call("/api/attendance/link",{cookie:admin.cookie,body:{branchId:"branch-delta",name:"ANA PRUEBA",memberId:"test-delta-ana"}});
  assert.equal(linked.status,200,JSON.stringify(linked));
  const deltaAfter=await call("/api/attendance/sheets?branch=branch-delta",{cookie:admin.cookie});
  const victoriaAfter=await call("/api/attendance/sheets?branch=branch-victoria",{cookie:admin.cookie});
  assert.equal(deltaAfter.body.rows[0].memberId,"test-delta-ana");
  assert.equal(victoriaAfter.body.rows[0].memberId,null,"A Delta link never changes Victoria's homonym.");
  console.log("PASS: four source formats including Vilo, branch isolation, idempotent snapshots, corrected daily marks, ignored totals/notes, scoped links, source validation, reusable Apps Script.");
} finally {await worker.dispose();}
