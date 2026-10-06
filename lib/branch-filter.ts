import { defaultBranches } from "@/lib/branch-catalog";
import { scopeBranchIds } from "@/lib/permissions";

type BranchFilterResult = { branchId: string; branchIds: string[] } | { error: string; status: 400 | 403 };

/** The UI's all option means only the branches assigned to the authenticated employee. */
export function effectiveBranchFilter(requested: string | null, viewerScope: string): BranchFilterResult {
  const requestedBranch = requested?.trim() || "all";
  if (requestedBranch !== "all" && !defaultBranches.some(branch => branch.id === requestedBranch)) return { error: "Elegí una sede válida.", status: 400 };
  const allowed = scopeBranchIds(viewerScope);
  if (!allowed.length) return { error: "Pedile al administrador general que asigne una sede a tu cuenta.", status: 403 };
  if (requestedBranch !== "all" && !allowed.includes(requestedBranch)) return { error: "No podés consultar información de otra sede.", status: 403 };
  const branchIds = requestedBranch === "all" ? allowed : [requestedBranch];
  return { branchId: branchIds.length === 1 ? branchIds[0] : requestedBranch, branchIds };
}
