import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { employees } from "@/db/schema";
import { clearAccountAttempts, limitAuthAttempts, rejectUnsafeRequest } from "@/lib/auth-security";
import {
  authErrorMessage,
  cookieOptions,
  createEmployeeSession,
  normalizeUsername,
  PASSWORD_ITERATIONS,
  SESSION_COOKIE,
  verifyPassword,
} from "@/lib/auth";

export async function POST(request: Request) {
  let stage = "login.validate";
  try {
    const rejected = rejectUnsafeRequest(request);
    if (rejected) return rejected;
    const body = (await request.json()) as { username?: string; password?: string };
    if (typeof body.username !== "string" || typeof body.password !== "string" || body.username.length > 40 || body.password.length > 128) return Response.json({ error: "Usuario o contraseña incorrectos." }, { status: 400 });
    const username = normalizeUsername(body.username ?? "");
    const password = body.password ?? "";
    const limited = await limitAuthAttempts(request, `login:${username}`);
    if (limited) return limited;
    const db = getDb();
    const [employee] = await db.select().from(employees).where(eq(employees.username, username)).limit(1);
    stage = "login.verify_password";
    const valid = await verifyPassword(password, employee?.passwordHash ?? "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", employee?.passwordSalt ?? "AAAAAAAAAAAAAAAAAAAAAA", employee?.passwordIterations ?? PASSWORD_ITERATIONS);
    if (!employee || !employee.active || !valid) {
      return Response.json({ error: "Usuario o contraseña incorrectos." }, { status: 401 });
    }
    await clearAccountAttempts(`login:${username}`);
    stage = "login.create_session";
    const session = await createEmployeeSession(employee.id);
    const response = Response.json({ ok: true, user: { id: employee.id, username: employee.username, displayName: employee.displayName, role: employee.role } });
    response.headers.append("Set-Cookie", `${SESSION_COOKIE}=${session.token}; Max-Age=${cookieOptions().maxAge}; Path=/; HttpOnly; SameSite=Lax${cookieOptions().secure ? "; Secure" : ""}`);
    return response;
  } catch (error) {
    return Response.json({ error: authErrorMessage(error, stage) }, { status: 500 });
  }
}
