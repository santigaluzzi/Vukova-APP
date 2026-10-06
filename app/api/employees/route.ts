import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { employees, auditLogs, sessions } from "@/db/schema";
import { ensureDefaultBranches, defaultBranches } from "@/lib/branches";
import { authErrorMessage, createPasswordRecord, getCurrentEmployee, isUniqueConstraintError, normalizeUsername } from "@/lib/auth";
import { clearAccountAttempts } from "@/lib/auth-security";
import { can, canManageEmployee, employeeScope, encodeBranchScope, normalizeRole, roleLabels, scopeBranchIds, type EmployeeRole } from "@/lib/permissions";
import { rejectUnsafeRequest } from "@/lib/auth-security";
import { effectiveBranchFilter } from "@/lib/branch-filter";

function publicEmployee(row: typeof employees.$inferSelect) {
  const role = normalizeRole(row.role) ?? "teacher";
  const branchScope = employeeScope(role, row.branchScope);
  const ids = scopeBranchIds(branchScope);
  return { id: row.id, username: row.username, displayName: row.displayName, email: row.email,
    role, roleLabel: roleLabels[role], branchScope,
    branchName: role === "admin" ? "Todas las sedes" : ids.map(id => defaultBranches.find(b => b.id === id)!.name.replace("Vukova ", "")).join(", ") || "Pendiente de asignar sede",
    active: row.active, createdAt: row.createdAt };
}
function validatedAccess(body: Record<string, unknown>) {
  if (typeof body.role !== "string" || !Object.prototype.hasOwnProperty.call(roleLabels, body.role) || typeof body.branchScope !== "string") return null;
  const role = body.role as EmployeeRole;
  if (role === "admin") return body.branchScope === "all" ? { role, branchScope: "all" } : null;
  let ids: unknown = [body.branchScope];
  if (body.branchScope.startsWith("[")) { try { ids = JSON.parse(body.branchScope); } catch { return null; } }
  if (!Array.isArray(ids) || !ids.length || ids.length > defaultBranches.length || ids.some(id => !defaultBranches.some(b => b.id === id)) || new Set(ids).size !== ids.length || (role !== "teacher" && ids.length !== 1)) return null;
  return { role, branchScope: encodeBranchScope(ids as string[]) };
}
async function teamViewer() {
  const viewer = await getCurrentEmployee();
  if (!viewer) return { error: Response.json({ error: "Necesitás iniciar sesión." }, { status: 401 }) };
  if (!can(viewer.role, "users.manage") || !scopeBranchIds(viewer.branchScope).length) return { error: Response.json({ error: "No tenés permisos para administrar estas cuentas." }, { status: 403 }) };
  return { viewer };
}
export async function GET(request: Request) {
  try {
    const access = await teamViewer(); if (access.error) return access.error;
    const viewer = access.viewer!;
    const selected = effectiveBranchFilter(new URL(request.url).searchParams.get("branch"), viewer.branchScope);
    if ("error" in selected) return Response.json({ error: selected.error }, { status: selected.status });
    const rows = await getDb().select().from(employees).orderBy(asc(employees.displayName));
    const visible = rows.filter(row => canManageEmployee(viewer, row)).map(publicEmployee)
      .filter(row => selected.branchId === "all" || scopeBranchIds(row.branchScope).includes(selected.branchId));
    return Response.json({ employees: visible }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ error: authErrorMessage(error) }, { status: 500 }); }
}
export async function POST(request: Request) {
  try {
    const rejected = rejectUnsafeRequest(request); if (rejected) return rejected;
    const access = await teamViewer(); if (access.error) return access.error;
    const viewer = access.viewer!;
    let body: Record<string, unknown>;
    try { body = await request.json(); } catch { return Response.json({ error: "Datos inválidos." }, { status: 400 }); }
    if (!body || [body.displayName, body.username, body.password, body.confirmPassword].some(value => typeof value !== "string") || (body.email != null && typeof body.email !== "string")) return Response.json({ error: "Completá los campos solicitados." }, { status: 400 });
    const assignment = validatedAccess(body);
    if (!assignment) return Response.json({ error: "Elegí un rol válido: encargado y administrativo requieren una sede; profesor, una o más sedes." }, { status: 400 });
    if (assignment.role === "branch_manager" && viewer.role !== "admin") return Response.json({ error: "Solo el administrador general puede crear cuentas de encargados/coordinadores." }, { status: 403 });
    if (!canManageEmployee(viewer, assignment)) return Response.json({ error: "Solo podés crear cuentas con acceso a tu sede. El administrador general asigna accesos globales o a varias sedes." }, { status: 403 });
    const displayName = (body.displayName as string).trim(), username = normalizeUsername(body.username as string), email = (body.email as string | undefined)?.trim() || null, password = body.password as string;
    if (displayName.length < 3 || displayName.length > 120) return Response.json({ error: "Ingresá el nombre completo del empleado." }, { status: 400 });
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) return Response.json({ error: "El usuario debe tener entre 3 y 40 caracteres: letras, números, punto, guion o guion bajo." }, { status: 400 });
    if (password.length < 12 || password.length > 128) return Response.json({ error: "La contraseña debe tener entre 12 y 128 caracteres." }, { status: 400 });
    if (password !== body.confirmPassword) return Response.json({ error: "Las contraseñas no coinciden." }, { status: 400 });
    const branches = await ensureDefaultBranches();
    if (scopeBranchIds(assignment.branchScope).some(id => !branches.some(b => b.id === id))) return Response.json({ error: "Una sede seleccionada está inactiva." }, { status: 400 });
    const db = getDb(), now = new Date().toISOString(), id = crypto.randomUUID();
    const passwordRecord = await createPasswordRecord(password);
    await db.batch([db.insert(employees).values({ id, username, displayName, email, ...passwordRecord, ...assignment, active: true, createdAt: now, updatedAt: now }),
      db.insert(auditLogs).values({ id: crypto.randomUUID(), employeeId: viewer.id, action: "employee.created", entityType: "employee", entityId: id, metadataJson: JSON.stringify({ username, ...assignment }), createdAt: now, updatedAt: now })]);
    const [created] = await db.select().from(employees).where(eq(employees.id, id)).limit(1);
    return Response.json({ employee: publicEmployee(created) }, { status: 201 });
  } catch (error) {
    if (isUniqueConstraintError(error)) return Response.json({ error: "Ese usuario ya existe." }, { status: 409 });
    return Response.json({ error: authErrorMessage(error) }, { status: 500 });
  }
}
export async function PATCH(request: Request) {
  try {
    const rejected = rejectUnsafeRequest(request); if (rejected) return rejected;
    const access = await teamViewer(); if (access.error) return access.error;
    const viewer = access.viewer!;
    let body: Record<string, unknown>;
    try { body = await request.json(); } catch { return Response.json({ error: "Datos inválidos." }, { status: 400 }); }
    if (!body || typeof body.id !== "string") return Response.json({ error: "Elegí una cuenta." }, { status: 400 });
    const assignment = validatedAccess(body);
    if (!assignment) return Response.json({ error: "Revisá el rol y las sedes seleccionadas." }, { status: 400 });
    const db = getDb();
    const [existing] = await db.select().from(employees).where(eq(employees.id, body.id)).limit(1);
    if (!existing || !canManageEmployee(viewer, existing) || !canManageEmployee(viewer, assignment)) return Response.json({ error: "No podés modificar cuentas o asignar accesos fuera de tu sede." }, { status: 403 });
    if (viewer.role !== "admin" && (normalizeRole(existing.role) === "branch_manager" || assignment.role === "branch_manager")) return Response.json({ error: "Solo el administrador general puede cambiar el rol o las sedes de un encargado/coordinador." }, { status: 403 });
    if (existing.id === viewer.id && (assignment.role !== viewer.role || assignment.branchScope !== viewer.branchScope)) return Response.json({ error: "Otro administrador debe cambiar el rol o las sedes de tu propia cuenta." }, { status: 409 });
    const resetPassword = body.password !== undefined || body.confirmPassword !== undefined;
    if (resetPassword && (typeof body.password !== "string" || body.password.length < 12 || body.password.length > 128 || body.password !== body.confirmPassword)) return Response.json({ error: "La nueva contraseña debe tener entre 12 y 128 caracteres y coincidir en ambos campos." }, { status: 400 });
    const branches = await ensureDefaultBranches();
    if (scopeBranchIds(assignment.branchScope).some(id => !branches.some(b => b.id === id))) return Response.json({ error: "Una sede seleccionada está inactiva." }, { status: 400 });
    const now = new Date().toISOString();
    const passwordRecord = resetPassword ? await createPasswordRecord(body.password as string) : {};
    const update = db.update(employees).set({ ...assignment, ...passwordRecord, updatedAt: now }).where(and(eq(employees.id, existing.id), eq(employees.role, existing.role), eq(employees.branchScope, existing.branchScope))).returning({ id: employees.id });
    const audit = db.insert(auditLogs).values({ id: crypto.randomUUID(), employeeId: viewer.id, action: resetPassword ? "employee.credentials_reset" : "employee.permissions_updated", entityType: "employee", entityId: existing.id, metadataJson: JSON.stringify({ previous: { role: existing.role, branchScope: existing.branchScope }, ...assignment, sessionsRevoked: resetPassword }), createdAt: now, updatedAt: now });
    const [updated] = resetPassword ? await db.batch([update, audit, db.delete(sessions).where(eq(sessions.employeeId, existing.id))]) : await db.batch([update, audit]);
    if (!updated.length) return Response.json({ error: "La cuenta cambió mientras la editabas. Actualizá el listado y volvé a intentar." }, { status: 409 });
    if (resetPassword) await clearAccountAttempts(`login:${existing.username}`);
    return Response.json({ employee: publicEmployee({ ...existing, ...assignment }) });
  } catch (error) { return Response.json({ error: authErrorMessage(error) }, { status: 500 }); }
}
