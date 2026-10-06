import { getDb } from "@/db";
import { employees } from "@/db/schema";
import { ensureDefaultBranches } from "@/lib/branches";
import { limitAuthAttempts, rejectUnsafeRequest, validSetupKey } from "@/lib/auth-security";
import {
  authErrorMessage,
  cookieOptions,
  createEmployeeSession,
  createPasswordRecord,
  hasEmployees,
  isUniqueConstraintError,
  normalizeUsername,
  SESSION_COOKIE,
} from "@/lib/auth";

export async function POST(request: Request) {
  let stage = "setup.validate";
  try {
    const rejected = rejectUnsafeRequest(request);
    if (rejected) return rejected;
    if (await hasEmployees()) return Response.json({ error: "La cuenta administradora ya fue creada." }, { status: 409 });
    const limited = await limitAuthAttempts(request, "setup");
    if (limited) return limited;
    const body = (await request.json()) as { setupKey?: string; displayName?: string; username?: string; password?: string; confirmPassword?: string };
    if (!(await validSetupKey(body.setupKey))) return Response.json({ error: "Necesitás el código privado de activación para crear la primera cuenta." }, { status: 403 });
    if ([body.displayName, body.username, body.password, body.confirmPassword].some((value) => typeof value !== "string")) return Response.json({ error: "Completá los campos solicitados." }, { status: 400 });
    const displayName = body.displayName?.trim() ?? "";
    const username = normalizeUsername(body.username ?? "");
    const password = body.password ?? "";
    if (displayName.length < 3) return Response.json({ error: "Ingresá el nombre de la persona administradora." }, { status: 400 });
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) return Response.json({ error: "El usuario debe tener entre 3 y 40 caracteres: letras, números, punto, guion o guion bajo." }, { status: 400 });
    if (password.length < 12 || password.length > 128) return Response.json({ error: "La contraseña debe tener entre 12 y 128 caracteres." }, { status: 400 });
    if (password !== body.confirmPassword) return Response.json({ error: "Las contraseñas no coinciden." }, { status: 400 });

    const now = new Date().toISOString();
    // Unique primary key makes simultaneous bootstrap requests mutually exclusive.
    const employeeId = "initial-administrator";
    stage = "setup.hash_password";
    const passwordRecord = await createPasswordRecord(password);
    const db = getDb();
    stage = "setup.save_employee";
    await db.insert(employees).values({
      id: employeeId,
      username,
      displayName,
      email: null,
      ...passwordRecord,
      role: "admin",
      branchScope: "all",
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    stage = "setup.seed_branches";
    await ensureDefaultBranches();
    stage = "setup.create_session";
    const session = await createEmployeeSession(employeeId);
    const response = Response.json({ ok: true, user: { id: employeeId, username, displayName, role: "admin" } }, { status: 201 });
    response.headers.append("Set-Cookie", `${SESSION_COOKIE}=${session.token}; Max-Age=${cookieOptions().maxAge}; Path=/; HttpOnly; SameSite=Lax${cookieOptions().secure ? "; Secure" : ""}`);
    return response;
  } catch (error) {
    if (isUniqueConstraintError(error)) return Response.json({ error: "La cuenta administradora ya fue creada." }, { status: 409 });
    return Response.json({ error: authErrorMessage(error, stage) }, { status: 500 });
  }
}
