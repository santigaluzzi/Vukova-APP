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
  const db=await worker.getD1Database("DB");
  for(const name of readdirSync(path.join(root,"drizzle")).filter(name=>name.endsWith(".sql")).sort())await db.batch(readFileSync(path.join(root,"drizzle",name),"utf8").split("--> statement-breakpoint").map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
  const admin=await call("/api/auth/setup",{body:{setupKey,displayName:"Payroll Admin",username:"payroll.admin",password,confirmPassword:password}});assert.equal(admin.status,201);
  const olivos="branch-olivos",delta="branch-delta",period="2026-09",workOn="2026-09-01";
  async function create(username,role,branchScope){const created=await call("/api/employees",{cookie:admin.cookie,body:{displayName:username,username,email:"",role,branchScope,password,confirmPassword:password}});assert.equal(created.status,201,JSON.stringify(created.payload));const login=await call("/api/auth/login",{body:{username,password}});assert.equal(login.status,200);return {id:created.payload.employee.id,cookie:login.cookie};}
  const manager=await create("payroll.manager","branch_manager",olivos),office=await create("payroll.office","administrative",olivos),teacherA=await create("payroll.teacher-a","teacher",JSON.stringify([olivos,delta])),teacherB=await create("payroll.teacher-b","teacher",olivos),foreign=await create("payroll.foreign","branch_manager",delta);
  const post=(account,body)=>call("/api/payroll",{cookie:account.cookie,body});
  const get=(account,scope="self",branch="all")=>call(`/api/payroll?period=${period}&scope=${scope}&branch=${branch}`,{cookie:account.cookie});
  assert.equal((await call("/api/payroll")).status,401);
  assert.equal((await get(teacherA,"team")).status,403);assert.equal((await get(office,"team")).status,403);assert.equal((await get(manager,"team",delta)).status,403);
  for(const account of [teacherA,office])for(const action of ["rate","commission","presentism"])assert.equal((await post(account,{action,branchId:olivos,employeeId:teacherA.id})).status,403);
  const rateBody={action:"rate",branchId:olivos,employeeId:manager.id,effectiveFrom:workOn,amountCents:200000};
  assert.equal((await post(manager,rateBody)).status,403);assert.equal((await post(admin,rateBody)).status,200);
  assert.equal((await post(foreign,{...rateBody,employeeId:teacherA.id})).status,403);
  for(const employee of [teacherA,teacherB,office])assert.equal((await post(manager,{...rateBody,employeeId:employee.id,amountCents:100000})).status,200);
  assert.equal((await post(admin,{...rateBody,employeeId:teacherA.id,branchId:delta,amountCents:300000})).status,200);
  assert.equal((await post(manager,{...rateBody,employeeId:teacherA.id,effectiveFrom:"2026-09-15",amountCents:200000})).status,200);
  assert.equal((await call("/api/employees",{cookie:office.cookie,body:{displayName:"Escalation",username:"payroll.escalate",role:"branch_manager",branchScope:olivos,password,confirmPassword:password}})).status,403);
  assert.equal((await call("/api/employees",{cookie:manager.cookie,method:"PATCH",body:{id:foreign.id,role:"administrative",branchScope:delta}})).status,403);
  // Teachers now record hours by confirming scheduled turns; direct hour-entry is reserved for non-teaching staff.
  const stamp=new Date().toISOString();
  for(const [account,branchId,day,start,end] of [[teacherA,olivos,workOn,7,8],[teacherA,olivos,"2026-09-20",18,19],[teacherA,delta,"2026-09-02",7,8],[teacherB,olivos,workOn,7,13]])await db.prepare("INSERT INTO work_shift_records (id,employee_id,branch_id,work_on,start_hour,end_hour,status,confirmed_at,updated_by,note,created_at,updated_at) VALUES (?,?,?,?,?,?,'confirmed',?,?,?, ?,?)").bind(`${account.id}:${branchId}:${day}:${start}:${end}`,account.id,branchId,day,start,end,stamp,account.id,"Test shift",stamp,stamp).run();
  for(const [account,branchId,day,minutes] of [[office,olivos,workOn,480],[manager,olivos,workOn,120]])assert.equal((await post(account,{action:"hours",branchId,workOn:day,minutes,note:"Test shift"})).status,200);
  assert.equal((await post(office,{action:"hours",branchId:olivos,workOn,minutes:60})).status,200,"Resaving replaces a day instead of duplicating");
  assert.equal((await post(manager,{action:"hours",branchId:olivos,workOn:"2099-01-01",minutes:60})).status,400);
  assert.equal((await post(manager,{action:"hours",branchId:olivos,workOn,minutes:1441})).status,400,"A manual entry cannot exceed 24 hours");
  assert.equal((await post(manager,{action:"hours",branchId:olivos,workOn,minutes:1.5})).status,400);
  assert.equal((await post(teacherA,{action:"hours",branchId:olivos,workOn,minutes:60,employeeId:teacherB.id})).status,403);
  assert.equal((await post(teacherB,{action:"delete_hours",branchId:delta,workOn})).status,403);
  const concurrent=await Promise.all([olivos,delta].map(branchId=>post(teacherA,{action:"hours",branchId,workOn:"2026-09-02",minutes:900})));
  assert.deepEqual(concurrent.map(r=>r.status),[403,403],"Teachers cannot bypass scheduled-turn confirmation with direct entries");
  assert.equal((await post(manager,{action:"commission",branchId:olivos,period,commissionBps:1000})).status,200);
  assert.equal((await post(admin,{action:"commission",branchId:delta,period,commissionBps:500})).status,200);
  assert.equal((await post(manager,{action:"presentism",branchId:olivos,period,employeeId:teacherA.id,eligible:true})).status,200);
  assert.equal((await post(manager,{action:"presentism",branchId:olivos,period,employeeId:teacherB.id,eligible:false})).status,200);
  assert.equal((await post(admin,{action:"presentism",branchId:delta,period,employeeId:teacherA.id,eligible:true})).status,200);
  const catalog=await call(`/api/plans?period=${period}&branch=${olivos}`,{cookie:manager.cookie});assert.equal(catalog.status,200);
  const plans=catalog.payload.rows.find(row=>row.branchId===olivos&&row.service==="gym").plans;
  const cashPlan=plans.find(plan=>plan.id==="gym-1"),cardPlan=plans.find(plan=>plan.id==="gym-6-card");
  const paymentBody={action:"new_member",requestId:randomBytes(18).toString("hex"),newMember:{name:"Payroll new member",branchId:olivos,service:"gym"},planId:cashPlan.id,saleOn:workOn,terminal:"cash",cardInstallments:null,amountCents:cashPlan.amountCents,surchargeBps:0};
  const payment=await call("/api/payments",{cookie:manager.cookie,body:paymentBody});assert.equal(payment.status,201,JSON.stringify(payment.payload));
  assert.equal((await call("/api/payments",{cookie:manager.cookie,body:paymentBody})).status,200,"A retried payment is not a second sale");
  const renewal=await call("/api/payments",{cookie:manager.cookie,body:{...paymentBody,action:"renewal",memberId:payment.payload.member.id,requestId:randomBytes(18).toString("hex")}});assert.equal(renewal.status,201,JSON.stringify(renewal.payload));
  let mine=await get(teacherA);assert.equal(mine.status,200,JSON.stringify(mine.payload));
  const a=mine.payload.rows.find(r=>r.branchId===olivos);
  assert.equal(a.baseCents,300000);assert.equal(a.presentismCents,30000);assert.equal(a.commissions.ARS,Math.round(cashPlan.amountCents*0.1*120/480));assert.equal(a.totalCents,a.baseCents+a.presentismCents+a.commissions.ARS);assert.equal(a.teacherTotalMinutes,480);
  assert.equal(mine.payload.funds.length,0);assert.ok(mine.payload.entries.every(e=>e.employeeId===teacherA.id));assert.ok(mine.payload.rates.every(e=>e.employeeId===teacherA.id));assert.ok(mine.payload.employees.every(e=>e.id===teacherA.id));
  assert.ok(!JSON.stringify(mine.payload).includes(teacherB.id));assert.ok(!JSON.stringify(mine.payload).includes("Payroll new member"));
  let team=await get(manager,"team");assert.equal(team.status,200);assert.ok(team.payload.rows.every(r=>r.branchId===olivos));assert.equal(team.payload.funds[0].newSales,1);assert.equal(team.payload.funds[0].netCents,cashPlan.amountCents);assert.equal(team.payload.funds[0].poolCents,Math.round(cashPlan.amountCents*0.1));
  assert.equal(team.payload.rows.find(r=>r.employeeId===teacherB.id).commissions.ARS,Math.round(cashPlan.amountCents*0.1*360/480));assert.equal(team.payload.rows.find(r=>r.employeeId===office.id).commissions.ARS,0);
  // Existing paid sales are classified from their original audit event, without guessing.
  await db.prepare("UPDATE payments SET sale_kind=NULL,sale_branch_id=NULL WHERE id=?").bind(payment.payload.paymentId).run();
  team=await get(manager,"team");assert.equal(team.payload.funds[0].newSales,1);assert.equal(team.payload.funds[0].netCents,cashPlan.amountCents);
  // Missing card costs stay pending until financial costs are completed.
  const feeKeys=["collectionFeePpm","collectionFeeVatPpm","financingFeePpm","financingFeeVatPpm","otherCostPpm","otherTaxPpm","iibbRetentionPpm","fixedCostCents"];
  const card=await call("/api/payments",{cookie:manager.cookie,body:{...paymentBody,newMember:{name:"Payroll card member",branchId:olivos,service:"gym"},planId:cardPlan.id,amountCents:cardPlan.amountCents,terminal:"nave",cardInstallments:cardPlan.installments,requestId:randomBytes(18).toString("hex"),fees:{...Object.fromEntries(feeKeys.map(k=>[k,null])),accreditationDays:0}}});
  assert.equal(card.status,201,JSON.stringify(card.payload));team=await get(manager,"team");assert.equal(team.payload.funds[0].missingNet,1);assert.equal(team.payload.rows.find(r=>r.employeeId===teacherA.id).commissions.ARS,null);
  await db.prepare("UPDATE sales_plan_scenarios SET collection_fee_ppm=0,collection_fee_vat_ppm=0,financing_fee_ppm=0,financing_fee_vat_ppm=0,other_cost_ppm=0,other_tax_ppm=0,iibb_retention_ppm=0,fixed_cost_cents=0 WHERE id=?").bind(card.payload.sale.id).run();
  team=await get(manager,"team");assert.equal(team.payload.funds[0].missingNet,0);assert.ok(team.payload.funds[0].netCents>cashPlan.amountCents);
  // Disabling a worker must not erase their already worked hours from the branch's denominator.
  await db.prepare("UPDATE employees SET active=0 WHERE id=?").bind(teacherB.id).run();team=await get(manager,"team");assert.equal(team.payload.funds[0].teacherMinutes,480);
  const audit=await db.prepare("SELECT count(*) AS n FROM audit_logs WHERE entity_type='payroll'").first();assert.ok(audit.n>10);
  console.log("PASS: payroll storage, scoped self/team access, coordinator rate authority, scheduled-turn entry rules, monthly bonuses, real new-sale commissions, legacy classification and missing-cost recovery.");
} finally {await worker.dispose();}
