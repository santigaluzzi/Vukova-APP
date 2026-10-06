import { getCurrentEmployee } from "@/lib/auth";
import { can, hasBranchAccess, scopeBranchIds } from "@/lib/permissions";
import { ACASSUSO_BRANCH } from "@/lib/sheet-data";

export async function sheetViewer(permission: string, scope: "acassuso" | "members" = "acassuso") {
  const viewer = await getCurrentEmployee();
  if (!viewer) return { error: Response.json({ error: "Ingresá con tu cuenta." }, { status: 401 }) };
  const allowedBranch = (scope === "members" ? scopeBranchIds(viewer.branchScope).length > 0 : hasBranchAccess(viewer.branchScope, ACASSUSO_BRANCH));
  if (!can(viewer.role, permission) || !allowedBranch) return { error: Response.json({ error: "Tu cuenta no tiene acceso a estos datos." }, { status: 403 }) };
  return { viewer };
}
