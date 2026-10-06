import { defaultBranches } from "./branch-catalog";

export type EmployeeRole = "admin" | "branch_manager" | "administrative" | "teacher";
export const roleLabels: Record<EmployeeRole, string> = {
  admin: "Administrador general", branch_manager: "Coordinador / encargado de sede",
  administrative: "Administrativo", teacher: "Profesor",
};
const branchPermissions = ["overview.read", "members.read", "members.manage", "attendance.manage", "payments.manage", "payments.register", "finance.manage", "users.manage", "settings.manage"];
export const rolePermissions: Record<EmployeeRole, string[]> = {
  admin: ["all"], branch_manager: [...branchPermissions, "payroll.self", "payroll.manage"], administrative: [...branchPermissions, "payroll.self"],
  teacher: ["members.read", "attendance.manage", "payroll.self"],
};
export function can(role: EmployeeRole, permission: string) {
  const permissions = rolePermissions[role] ?? [];
  return permissions.includes("all") || permissions.includes(permission);
}
export function canAny(role: EmployeeRole, permissions: string[]) { return permissions.some(permission => can(role, permission)); }
export function normalizeRole(role: string): EmployeeRole | null {
  if (role === "reception" || role === "finance") return "administrative";
  return Object.prototype.hasOwnProperty.call(roleLabels, role) ? role as EmployeeRole : null;
}
/** One branch remains a plain ID; multiple assigned branches use a JSON array. */
export function scopeBranchIds(scope: string): string[] {
  if (scope === "all") return defaultBranches.map(branch => branch.id);
  let values: unknown = [scope];
  if (scope.startsWith("[")) { try { values = JSON.parse(scope); } catch { return []; } }
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((id): id is string => typeof id === "string" && defaultBranches.some(branch => branch.id === id)))];
}
export function encodeBranchScope(ids: string[]) { return ids.length === 1 ? ids[0] : JSON.stringify(ids); }
export function hasBranchAccess(scope: string, branchId: string) { return scopeBranchIds(scope).includes(branchId); }
export function employeeScope(role: EmployeeRole, storedScope: string) {
  if (role === "admin") return "all";
  // Old global finance accounts need an explicit branch assignment; never widen their access.
  if (storedScope === "all") return "[]";
  const ids = scopeBranchIds(storedScope);
  return role !== "teacher" && ids.length !== 1 ? "[]" : encodeBranchScope(ids);
}
export function canManageEmployee(viewer: { role: EmployeeRole; branchScope: string }, target: { role: string; branchScope: string }) {
  if (viewer.role === "admin") return true;
  if (!can(viewer.role, "users.manage") || normalizeRole(target.role) === "admin" || target.branchScope === "all") return false;
  const targetBranches = scopeBranchIds(target.branchScope);
  return targetBranches.length > 0 && targetBranches.every(id => hasBranchAccess(viewer.branchScope, id));
}
