import { getRawDb } from "@/db";
import { sha256, rejectUnsafeRequest } from "@/lib/auth-security";
import { sheetViewer } from "@/lib/sheet-views";
import { sheetsScript, membersScript } from "@/lib/sheets-script";
import { ROSTER_SOURCES } from "@/lib/roster-sources";
import { attendanceSyncSources } from "@/lib/attendance-sources";

export async function GET() {
  const access = await sheetViewer("settings.global", "members"); if (access.error) return access.error;
  const db = getRawDb();
  const connection = await db.prepare("SELECT created_at AS createdAt,last_used_at AS lastUsedAt FROM sheet_tokens WHERE id='acassuso-attendance'").first();
  const membersConnection = await db.prepare("SELECT created_at AS createdAt,last_used_at AS lastUsedAt FROM sheet_tokens WHERE id='members-rosters'").first();
  const imports = await db.prepare("SELECT id,branch_id AS branchId,kind,sheet_name AS sheetName,period,record_count AS records,review_json AS reviewJson,synced_at AS syncedAt FROM sheet_imports ORDER BY kind,period DESC").all();
  return Response.json({ connection, membersConnection, sources: ROSTER_SOURCES, attendanceSources:attendanceSyncSources(), imports: imports.results.map(r => ({...r, review:JSON.parse(String(r.reviewJson)), reviewJson:undefined})) });
}

export async function POST(request: Request) {
  const rejected = rejectUnsafeRequest(request); if (rejected) return rejected;
  const access = await sheetViewer("settings.global", "members"); if (access.error) return access.error;
  let body: {scope?:string;reuse?:boolean};
  try { body = await request.json(); } catch { return Response.json({error:"Formato inválido."},{status:400}); }
  if (!body || Array.isArray(body) || (body.scope !== undefined && !["attendance","members"].includes(body.scope)) || (body.reuse !== undefined && typeof body.reuse !== "boolean")) return Response.json({error:"Tipo de conexión inválido."},{status:400});
  const memberScope = body.scope === "members";
  const connectionId = memberScope ? "members-rosters" : "acassuso-attendance";
  if (body.reuse) {
    const connection = await getRawDb().prepare("SELECT id FROM sheet_tokens WHERE id=?").bind(connectionId).first();
    if (!connection) return Response.json({error:"Primero prepará una conexión de planillas."},{status:400});
    return Response.json({script:memberScope?membersScript(new URL(request.url).origin,null):sheetsScript(new URL(request.url).origin,null),reusesConnection:true},{headers:{"Cache-Control":"no-store"}});
  }
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,"0")).join("");
  const db = getRawDb(); const now = new Date().toISOString();
  await db.batch([
    db.prepare("INSERT INTO sheet_tokens (id,token_hash,created_at,last_used_at) VALUES (?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET token_hash=excluded.token_hash,created_at=excluded.created_at,last_used_at=NULL").bind(connectionId, await sha256(token), now),
    db.prepare("INSERT INTO audit_logs (id,employee_id,action,entity_type,entity_id) VALUES (?,?,?,?,?)").bind(crypto.randomUUID(), access.viewer!.id, "sheets.connection.rotate", "integration", connectionId),
  ]);
  return Response.json({ script: (memberScope ? membersScript : sheetsScript)(new URL(request.url).origin, token) }, {headers:{"Cache-Control":"no-store"}});
}
