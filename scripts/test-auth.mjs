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

async function call(route, { body, cookie, origin = "https://vukova.test" } = {}) {
  const response = await worker.dispatchFetch(`https://vukova.test${route}`, {
    method: body === undefined ? "GET" : "POST",
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
  for (const name of readdirSync(path.join(root, "drizzle")).filter((name) => name.endsWith(".sql")).sort()) {
    const sql = readFileSync(path.join(root, "drizzle", name), "utf8");
    await db.batch(sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean).map((s) => db.prepare(s)));
  }
  const setupPage = await worker.dispatchFetch("https://vukova.test/");
  assert.equal(setupPage.status, 200);
  assert.match(await setupPage.text(), /Código privado de activación/);
  assert.equal((await call("/api/employees")).status, 401);
  const fields = { displayName: "Test Administrator", username: "test.admin", password, confirmPassword: password };
  assert.equal((await call("/api/auth/setup", { body: fields })).status, 403);
  assert.equal((await call("/api/auth/setup", { body: { ...fields, setupKey }, origin: "https://other.test" })).status, 403);
  const bootstrap = await Promise.all([0, 1].map(() => call("/api/auth/setup", { body: { ...fields, setupKey } })));
  assert.deepEqual(bootstrap.map((r) => r.status).sort(), [201, 409], JSON.stringify(bootstrap.map((r) => ({ status: r.status, payload: r.payload }))));
  const admin = bootstrap.find((r) => r.status === 201);
  assert.ok(admin.cookie);
  assert.match(admin.headers.get("set-cookie"), /HttpOnly/);
  assert.match(admin.headers.get("set-cookie"), /Secure/);
  assert.equal((await call("/api/auth/status", { cookie: admin.cookie })).payload.user.role, "admin");
  const loginPage = await worker.dispatchFetch("https://vukova.test/");
  assert.equal(loginPage.status, 200);
  assert.match(await loginPage.text(), /Ingresar a Vukova/);

  const employee = { displayName: "Test Reception", username: "test.reception", email: "", role: "administrative", branchScope: "all", password, confirmPassword: password };
  assert.equal((await call("/api/employees", { cookie: admin.cookie, body: employee })).status, 400);
  employee.branchScope = "branch-victoria";
  assert.equal((await call("/api/employees", { cookie: admin.cookie, body: employee })).status, 201);
  assert.equal((await call("/api/employees", { cookie: admin.cookie, body: employee })).status, 409);
  const team = await call("/api/employees", { cookie: admin.cookie });
  assert.equal(team.payload.employees.length, 2);
  assert.ok(!JSON.stringify(team.payload).includes("password"));
  const credentials = await db.prepare("SELECT password_hash, password_salt, password_iterations FROM employees").all();
  assert.ok(credentials.results.every((r) => r.password_hash !== password && r.password_iterations === 600000));
  assert.notEqual(credentials.results[0].password_salt, credentials.results[1].password_salt);

  assert.equal((await call("/api/auth/login", { body: { username: employee.username, password: "wrong-password" } })).status, 401);
  const reception = await call("/api/auth/login", { body: { username: employee.username, password } });
  assert.equal(reception.status, 200);
  assert.equal((await call("/api/employees", { cookie: reception.cookie })).status, 200);
  assert.equal((await call("/api/employees", { cookie: reception.cookie, body: { ...employee, username: "another.user", role: "admin", branchScope: "all" } })).status, 403);
  const whoami = await call("/api/auth/status", { cookie: reception.cookie });
  assert.equal(whoami.payload.user.branchScope, "branch-victoria");
  assert.match(whoami.headers.get("cache-control"), /no-store/);
  assert.equal((await call("/api/auth/logout", { cookie: reception.cookie, body: {} })).status, 200);
  assert.equal((await call("/api/auth/status", { cookie: reception.cookie })).payload.authenticated, false);

  for (let i = 0; i < 10; i++) assert.equal((await call("/api/auth/login", { body: { username: "nonexistent", password: "wrong-password" } })).status, 401);
  assert.equal((await call("/api/auth/login", { body: { username: "nonexistent", password: "wrong-password" } })).status, 429);
  await db.prepare("UPDATE sessions SET expires_at = ?").bind("2000-01-01T00:00:00.000Z").run();
  assert.equal((await call("/api/employees", { cookie: admin.cookie })).status, 401);
  console.log("PASS: protected bootstrap, concurrency, login, roles, branch scope, password storage, throttling, logout and expired sessions.");
} finally {
  await worker.dispose();
}
