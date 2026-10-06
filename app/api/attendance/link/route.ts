import { getRawDb } from "@/db";
import { rejectUnsafeRequest } from "@/lib/auth-security";
import { ACASSUSO_BRANCH, normalizeName } from "@/lib/sheet-data";
import { sheetViewer } from "@/lib/sheet-views";
import { hasBranchAccess } from "@/lib/permissions";
import { ATTENDANCE_SOURCES } from "@/lib/attendance-sources";

export async function POST(request: Request) {
  const rejected = rejectUnsafeRequest(request); if (rejected) return rejected;
  const access = await sheetViewer("attendance.manage", "members"); if (access.error) return access.error;
  try {
    const body = await request.json() as { name?: string; memberId?: string; branchId?: string };
    if (typeof body.name !== "string" || body.name.length > 200 || typeof body.memberId !== "string") return Response.json({ error: "Seleccioná un socio." }, { status: 400 });
    const branchId=body.branchId ?? ACASSUSO_BRANCH;
    if (!ATTENDANCE_SOURCES.some(s=>s.branchId===branchId) || !hasBranchAccess(access.viewer!.branchScope,branchId)) return Response.json({error:"No tenés acceso a los presentes de esa sede."},{status:403});
    const key = normalizeName(body.name); const db = getRawDb();
    const source = await db.prepare("SELECT a.id FROM sheet_attendance a JOIN sheet_imports i ON i.id=a.import_id WHERE a.normalized_name=? AND i.branch_id=? LIMIT 1").bind(key,branchId).first();
    const member = await db.prepare("SELECT id,home_branch_id AS branchId FROM members WHERE id=?").bind(body.memberId).first<{id:string;branchId:string}>();
    if (!source || !member || !hasBranchAccess(access.viewer!.branchScope,member.branchId)) return Response.json({ error: "No se encontró el presente o el socio en tus sedes." }, { status: 400 });
    const now = new Date().toISOString();
    await db.batch([
      db.prepare(`INSERT INTO sheet_branch_name_links (branch_id,normalized_name,member_id,linked_by,linked_at) VALUES (?,?,?,?,?)
        ON CONFLICT(branch_id,normalized_name) DO UPDATE SET member_id=excluded.member_id,linked_by=excluded.linked_by,linked_at=excluded.linked_at`).bind(branchId,key,body.memberId,access.viewer!.id,now),
      db.prepare("INSERT INTO audit_logs (id,employee_id,action,entity_type,entity_id,metadata_json) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(), access.viewer!.id, "attendance.link", "member", body.memberId, JSON.stringify({ sourceName: key, branchId })),
    ]);
    return Response.json({ ok: true });
  } catch { console.error("sheet_attendance_link_failed"); return Response.json({ error: "No se pudo vincular el presente." }, { status: 500 }); }
}
