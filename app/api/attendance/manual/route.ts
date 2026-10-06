import { getRawDb } from "@/db";
import { getCurrentEmployee } from "@/lib/auth";
import { rejectUnsafeRequest } from "@/lib/auth-security";
import { attendanceIdentity, attendanceJoins } from "@/lib/attendance-queries";
import { hasBranchAccess, can } from "@/lib/permissions";
import { defaultBranches } from "@/lib/branch-catalog";
import { localDay, normalizeName } from "@/lib/sheet-data";

async function access(branchId: string) {
  const viewer = await getCurrentEmployee();
  if (!viewer) return { error: Response.json({ error: "Ingresá con tu cuenta." }, { status: 401 }) };
  if (!can(viewer.role, "attendance.manage") || !hasBranchAccess(viewer.branchScope, branchId))
    return { error: Response.json({ error: "Tu cuenta no puede registrar asistencias en esta sede." }, { status: 403 }) };
  if (!defaultBranches.some(b => b.id === branchId))
    return { error: Response.json({ error: "Elegí una sede válida." }, { status: 400 }) };
  return { viewer };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const branchId = params.get("branch") ?? "";
  const allowed = await access(branchId);
  if (allowed.error) return allowed.error;
  const query = params.get("q")?.trim() ?? "";
  if (query.length < 2 || query.length > 60) return Response.json({ members: [] });
  const normalized = normalizeName(query);
  const escaped = normalized.replace(/[\\%_]/g, "\\$&");
  try {
    // The visiting member can belong to any branch. Expose only the fields
    // needed to identify the correct gym membership at check-in.
    const rows = await getRawDb().prepare(`SELECT m.id,m.full_name AS name,m.home_branch_id AS homeBranchId,m.status
      FROM members m WHERE coalesce(m.service,'gym')='gym'
        AND (EXISTS (SELECT 1 FROM sheet_rosters r WHERE r.member_id=m.id AND r.archived_at IS NULL AND r.missing_since IS NULL)
          OR NOT EXISTS (SELECT 1 FROM sheet_rosters r WHERE r.member_id=m.id))
        AND (upper(m.full_name) LIKE ? ESCAPE '\\' OR EXISTS
          (SELECT 1 FROM sheet_rosters r WHERE r.member_id=m.id AND r.archived_at IS NULL AND r.normalized_name LIKE ? ESCAPE '\\'))
      ORDER BY m.full_name LIMIT 25`).bind(`%${query.toUpperCase().replace(/[\\%_]/g, "\\$&")}%`, `%${escaped}%`).all();
    return Response.json({ members: rows.results }, { headers: { "Cache-Control": "no-store" } });
  } catch { console.error("manual_attendance_search_failed"); return Response.json({ error: "No se pudieron buscar socios." }, { status: 500 }); }
}

export async function POST(request: Request) {
  const rejected = rejectUnsafeRequest(request);
  if (rejected) return rejected;
  let body: { branchId?: string; memberId?: string };
  try { body = await request.json() as typeof body; } catch { return Response.json({ error: "Datos inválidos." }, { status: 400 }); }
  const branchId = body?.branchId ?? "";
  const allowed = await access(branchId);
  if (allowed.error) return allowed.error;
  if (typeof body.memberId !== "string" || body.memberId.length > 120)
    return Response.json({ error: "Seleccioná un socio." }, { status: 400 });
  try {
    const db = getRawDb(), today = localDay();
    const member = await db.prepare(`SELECT m.id,m.full_name AS name,m.home_branch_id AS homeBranchId
      FROM members m WHERE m.id=? AND coalesce(m.service,'gym')='gym'
        AND (EXISTS (SELECT 1 FROM sheet_rosters r WHERE r.member_id=m.id AND r.archived_at IS NULL AND r.missing_since IS NULL)
          OR NOT EXISTS (SELECT 1 FROM sheet_rosters r WHERE r.member_id=m.id))`).bind(body.memberId).first<{id:string;name:string;homeBranchId:string}>();
    if (!member) return Response.json({ error: "No se encontró una ficha vigente de gimnasio para ese socio." }, { status: 404 });
    const imported = await db.prepare(`SELECT a.id FROM sheet_attendance a JOIN sheet_imports i ON i.id=a.import_id
      AND a.version=json_extract(i.review_json,'$.version') ${attendanceJoins}
      WHERE i.branch_id=? AND a.attended_on=? AND a.marker='1'
        AND (${attendanceIdentity}=? OR a.normalized_name=?) LIMIT 1`)
      .bind(branchId,today,member.id,normalizeName(member.name)).first();
    if (imported) return Response.json({ ok: true, alreadyPresent: true, source: "sheet", name: member.name });
    const id = `manual:${branchId}:${member.id}:${today}`, now = new Date().toISOString();
    const result = await db.prepare(`INSERT INTO attendance (id,member_id,branch_id,method,checked_in_at,recorded_by_employee_id,created_at,updated_at)
      VALUES (?, ?, ?, 'manual', ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
      .bind(id,member.id,branchId,now,allowed.viewer!.id,now,now).run();
    if (result.meta.changes) {
      await db.prepare(`INSERT INTO audit_logs (id,employee_id,action,entity_type,entity_id,metadata_json,created_at,updated_at)
        VALUES (?,?, 'attendance.manual', 'attendance', ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(),allowed.viewer!.id,id,JSON.stringify({branchId,memberId:member.id,day:today}),now,now).run();
    }
    return Response.json({ ok:true, alreadyPresent:!result.meta.changes, source:"manual", name:member.name });
  } catch { console.error("manual_attendance_save_failed"); return Response.json({ error:"No se pudo registrar la asistencia. Verificá si aparece antes de reintentar." }, { status:500 }); }
}
