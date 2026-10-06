import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Run against the actual built Worker with an isolated, disposable D1 database.
const require = createRequire(import.meta.url);
const { Miniflare } = createRequire(require.resolve("wrangler/package.json"))("miniflare");
const setupKey = randomBytes(32).toString("base64url");
const password = randomBytes(24).toString("base64url");
const root = path.resolve(import.meta.dirname, "..");
const serverRoot = path.join(root, "dist/server");
const moduleFiles = readdirSync(serverRoot, { recursive: true }).filter((name) => name.endsWith(".js") && name !== "index.js");
const emulateHostedCap = process.argv.includes("--cloudflare-pbkdf2-cap");
const capFixture = {
  type: "ESModule",
  path: path.join(serverRoot, "__test-entry.js"),
  contents: `
    import app from "./index.js";
    const nativeDeriveBits = crypto.subtle.deriveBits;
    crypto.subtle.deriveBits = async function (params, ...args) {
      if (params.name === "PBKDF2" && params.iterations > 100000) {
        throw new DOMException("Pbkdf2 failed: iteration counts above 100000 are not supported", "NotSupportedError");
      }
      return nativeDeriveBits.call(this, params, ...args);
    };
    export default app;
  `,
};
const worker = new Miniflare({
  modulesRoot: serverRoot,
  modules: [
    ...(emulateHostedCap ? [capFixture] : []),
    ...["index.js", ...moduleFiles].map((name) => ({ type: "ESModule", path: path.join(serverRoot, name) })),
  ],
  compatibilityDate: "2026-05-15",
  compatibilityFlags: ["nodejs_compat"],
  d1Databases: { DB: "auth-smoke-test" },
  bindings: { VUKOVA_SETUP_TOKEN_SHA256: createHash("sha256").update(setupKey).digest("hex") },
});

async function call(route, { body, cookie, method, origin = "https://vukova.test" } = {}) {
  const response = await worker.dispatchFetch(`https://vukova.test${route}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      "Content-Type": "application/json",
      "Origin": origin,
      "CF-Connecting-IP": "192.0.2.10",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error(`${route} returned ${response.status}: ${text.slice(0,400)}`); }
  return { status: response.status, payload, headers: response.headers, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

try {
  const db = await worker.getD1Database("DB");
  for (const name of readdirSync(path.join(root, "drizzle")).filter(name => name.endsWith(".sql")).sort()) {
    await db.batch(readFileSync(path.join(root, "drizzle", name), "utf8").split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
  }
  const admin = await call("/api/auth/setup", { body: { setupKey, displayName:"General Admin", username:"roles.admin", password, confirmPassword:password } });
  assert.equal(admin.status, 201);
  const employee = (username, role, branchScope) => ({username, displayName:username, email:"", role, branchScope, password, confirmPassword:password});
  async function create(username, role, branchScope) {
    const response = await call("/api/employees", {cookie:admin.cookie,body:employee(username,role,branchScope)});
    assert.equal(response.status, 201, JSON.stringify(response.payload));
    const login = await call("/api/auth/login", {body:{username,password}}); assert.equal(login.status,200);
    return {id:response.payload.employee.id,cookie:login.cookie};
  }
  const manager = await create("roles.manager", "branch_manager", "branch-olivos");
  const administrative = await create("roles.office", "administrative", "branch-olivos");
  const teacher = await create("roles.teacher", "teacher", JSON.stringify(["branch-olivos","branch-acassuso"]));
  const localTeacher = await create("roles.localteacher", "teacher", "branch-olivos");
  const foreignTeacher = await create("roles.foreignteacher", "teacher", "branch-victoria");
  for (const role of ["branch_manager","administrative","teacher"]) assert.equal((await call("/api/employees",{cookie:admin.cookie,body:employee("roles.invalid",role,"all")})).status,400);
  assert.equal((await call("/api/employees",{cookie:admin.cookie,body:employee("roles.invalid","administrative",JSON.stringify(["branch-olivos","branch-victoria"]))})).status,400);
  assert.equal((await call("/api/employees",{cookie:admin.cookie,body:employee("roles.invalid","teacher",JSON.stringify(["branch-olivos","invalid"]))})).status,400);
  const now = new Date().toISOString(), period = now.slice(0,7);
  for (const branch of ["olivos","acassuso","victoria"]) {
    const id=`fixture-${branch}`, history=[{period,amount:"987654321-secret-payment",state:"A",date:"12",plan:"Mensual",installment:"1/1"}];
    await db.prepare("INSERT INTO members (id,full_name,home_branch_id,status,service,plan_name) VALUES (?,?,?,'active','gym','Mensual')").bind(id,`Socio ${branch}`,`branch-${branch}`).run();
    await db.prepare("INSERT INTO sheet_rosters (id,member_id,source_sheet_id,source_row,source_name,normalized_name,service,source_state,history_json,review_json,imported_at,source_details_json) VALUES (?,?,1,2,?,?,'gym','A',?,'[]',?,?)")
      .bind(id,id,`Socio ${branch}`,`SOCIO ${branch}`,JSON.stringify(history),now,JSON.stringify({Descuento:"financial-discount-secret",Teléfono:"1111111"})).run();
  }
  for (const account of [manager, administrative]) {
    const members = await call("/api/members?branch=all", {cookie:account.cookie});
    assert.equal(members.status,200); assert.deepEqual(members.payload.members.map(m=>m.branchId),["branch-olivos"]);
    assert.equal(members.payload.canViewFinancials,true);
    for (const route of ["/api/members?branch=branch-victoria","/api/payments?branch=branch-victoria",`/api/finance/sales-plans?period=${period}&branch=branch-victoria`,"/api/employees?branch=branch-victoria"]) assert.equal((await call(route,{cookie:account.cookie})).status,403,route);
    for (const route of ["/api/payments",`/api/finance/sales-plans?period=${period}`,"/api/members/forecast?period="+period,"/api/attendance/sheets"]) assert.equal((await call(route,{cookie:account.cookie})).status,200,route);
    const team = await call("/api/employees",{cookie:account.cookie});
    assert.equal(team.status,200); assert.ok(team.payload.employees.some(e=>e.id===localTeacher.id));
    assert.ok(!team.payload.employees.some(e=>[teacher.id,foreignTeacher.id].includes(e.id)||e.role==="admin"));
    assert.equal((await call("/api/employees",{cookie:account.cookie,body:employee("roles.escalate","admin","all")})).status,403);
    assert.equal((await call("/api/employees",{cookie:account.cookie,body:employee("roles.outside","teacher","branch-victoria")})).status,403);
    assert.equal((await call("/api/employees",{cookie:account.cookie,method:"PATCH",body:{id:foreignTeacher.id,role:"teacher",branchScope:"branch-olivos"}})).status,403);
    assert.equal((await call("/api/employees",{cookie:account.cookie,method:"PATCH",body:{id:teacher.id,role:"teacher",branchScope:"branch-olivos"}})).status,403);
    assert.equal((await call("/api/settings/sheets",{cookie:account.cookie})).status,403,"Shared integration credentials must remain global-admin only");
  }
  const createdLocally = await call("/api/employees", {cookie:manager.cookie,body:employee("roles.localcreated","administrative","branch-olivos")});
  assert.equal(createdLocally.status,201);
  assert.equal((await call("/api/employees",{cookie:manager.cookie,method:"PATCH",body:{id:localTeacher.id,role:"administrative",branchScope:"branch-olivos"}})).status,200);
  assert.equal((await call(`/api/finance/sales-plans?period=${period}`,{cookie:localTeacher.cookie})).status,200,"Role changes apply to existing sessions");
  assert.equal((await call("/api/employees",{cookie:admin.cookie,method:"PATCH",body:{id:localTeacher.id,role:"teacher",branchScope:"branch-olivos"}})).status,200);
  assert.equal((await call(`/api/finance/sales-plans?period=${period}`,{cookie:localTeacher.cookie})).status,403,"Revocation applies without a new login");
  const replacement = randomBytes(24).toString("base64url");
  const reset = {id:foreignTeacher.id,role:"teacher",branchScope:"branch-victoria",password:replacement,confirmPassword:replacement};
  assert.equal((await call("/api/employees",{cookie:manager.cookie,method:"PATCH",body:reset})).status,403,"A branch manager cannot reset credentials outside their scope");
  assert.equal((await call("/api/employees",{cookie:admin.cookie,method:"PATCH",body:{...reset,password:"short",confirmPassword:"short"}})).status,400);
  assert.equal((await call("/api/employees",{cookie:admin.cookie,method:"PATCH",body:reset})).status,200);
  assert.equal((await call("/api/auth/status",{cookie:foreignTeacher.cookie})).status,200);
  assert.equal((await call("/api/auth/status",{cookie:foreignTeacher.cookie})).payload.user,null,"Existing sessions are revoked");
  assert.equal((await call("/api/auth/login",{body:{username:"roles.foreignteacher",password}})).status,401,"Old password no longer works");
  assert.equal((await call("/api/auth/login",{body:{username:"roles.foreignteacher",password:replacement}})).status,200,"New password works");
  const teacherData = await call("/api/members?branch=all",{cookie:teacher.cookie});
  assert.equal(teacherData.status,200); assert.equal(teacherData.payload.viewBranch,"all");
  assert.deepEqual(teacherData.payload.members.map(m=>m.branchId).sort(),["branch-acassuso","branch-olivos"]);
  assert.equal(teacherData.payload.canViewFinancials,false); assert.equal(teacherData.payload.canForecast,false);
  assert.ok(!JSON.stringify(teacherData.payload).includes("secret"));
  assert.ok(teacherData.payload.members.every(m=>!m.spreadsheetId && m.history.every(h=>!h.amount&&!h.date&&!h.installment)));
  assert.equal((await call("/api/members?branch=branch-victoria",{cookie:teacher.cookie})).status,403);
  assert.equal((await call("/api/attendance/sheets?analytics=1&branch=all",{cookie:teacher.cookie})).status,200);
  assert.equal((await call("/api/attendance/link",{cookie:localTeacher.cookie,body:{name:"X",memberId:"fixture-acassuso"}})).status,403);
  for (const route of ["/api/payments",`/api/finance/sales-plans?period=${period}`,"/api/members/forecast?period="+period,"/api/settings/sheets","/api/employees"]) {
    assert.equal((await call(route,{cookie:teacher.cookie})).status,403,route);
    assert.equal((await call(route,{cookie:teacher.cookie,body:{}})).status,403,route);
  }
  const rendered = await worker.dispatchFetch("https://vukova.test/",{headers:{Cookie:teacher.cookie}});
  assert.equal(rendered.status,200); const html=await rendered.text();
  for(const label of ["Cobros","Finanzas","Usuarios y permisos","Configuración","Resumen"]) assert.ok(!html.includes(`>${label}</span>`),`Teacher navigation hides ${label}`);
  assert.ok(html.includes(">Socios</span>")); assert.ok(html.includes(">Asistencias</span>"));
  const sale = {id:"fixture-sale-foreign",saleOn:`${period}-01`,branchId:"branch-victoria",planId:"gym-1",terminal:"cash",cardInstallments:null,quantity:1,amountCents:10000,surchargeBps:0,collectionFeePpm:0,collectionFeeVatPpm:0,financingFeePpm:0,financingFeeVatPpm:0,otherCostPpm:0,otherTaxPpm:0,iibbRetentionPpm:0,fixedCostCents:0,accreditationDays:0};
  const saved = await call("/api/finance/sales-plans",{cookie:admin.cookie,body:{period,rows:[sale]}});assert.equal(saved.status,200,JSON.stringify(saved.payload));
  assert.equal((await call("/api/finance/sales-plans",{cookie:manager.cookie,body:{period,rows:[sale]}})).status,403);
  assert.equal((await call("/api/finance/sales-plans",{cookie:manager.cookie,body:{period,rows:[{...sale,branchId:"branch-olivos"}]}})).status,403,"Cannot steal an ID from another branch");
  assert.equal((await call("/api/finance/sales-plans",{cookie:manager.cookie,body:{period,id:sale.id,action:"delete"}})).status,403);
  const localSale = {...sale,id:"fixture-sale-local",branchId:"branch-olivos"};
  assert.equal((await call("/api/finance/sales-plans",{cookie:manager.cookie,body:{period,rows:[localSale]}})).status,200);
  assert.equal((await call("/api/finance/sales-plans",{cookie:administrative.cookie,body:{period,rows:[{...localSale,amountCents:20000}]}})).status,200);
  const localFinance=await call(`/api/finance/sales-plans?period=${period}&branch=all`,{cookie:manager.cookie});
  assert.deepEqual(localFinance.payload.rows.map(row=>row.id),[localSale.id]);
  assert.equal((await call("/api/finance/sales-plans",{cookie:administrative.cookie,body:{period,id:localSale.id,action:"delete"}})).status,200);
  assert.ok(await db.prepare("SELECT id FROM sales_plan_scenarios WHERE id=?").bind(sale.id).first());
  // Safe compatibility for existing accounts: reception keeps its branch; old global finance needs assignment.
  await db.prepare("UPDATE employees SET role='reception' WHERE id=?").bind(administrative.id).run();
  assert.equal((await call("/api/auth/status",{cookie:administrative.cookie})).payload.user.role,"administrative");
  await db.prepare("UPDATE employees SET role='finance',branch_scope='all' WHERE id=?").bind(administrative.id).run();
  assert.equal((await call("/api/members",{cookie:administrative.cookie})).status,403);
  assert.equal((await call(`/api/finance/sales-plans?period=${period}`,{cookie:administrative.cookie})).status,403);
  console.log("PASS: four roles, multi-branch teachers, financial redaction, scoped reads/writes, account management, immediate permission changes and legacy scope safety.");
} finally { await worker.dispose(); }
