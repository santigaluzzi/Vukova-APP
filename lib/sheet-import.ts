import { env } from "cloudflare:workers";
import { getRawDb } from "@/db";
import { sha256 } from "@/lib/auth-security";
import { localDay, parseAttendance, parseRoster, validateMatrix } from "@/lib/sheet-data";
import { ATTENDANCE_SOURCES, attendanceTabPeriod } from "@/lib/attendance-sources";
import { ROSTER_SOURCES } from "@/lib/roster-sources";
import { reconcileSheets } from "@/lib/sheet-reconcile";
import { changedMonthEvents } from "@/lib/member-analytics";

type ImportAccess = "migration" | "attendance" | "members";
export async function importAccess(request: Request): Promise<ImportAccess | null> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!/^Bearer [A-Za-z0-9_-]{43,128}$/.test(authorization)) return null;
  const hash = await sha256(authorization.slice(7));
  const equal = (expected: string | null | undefined) => {
    if (!expected || expected.length !== hash.length) return false;
    let difference = 0; for (let i = 0; i < hash.length; i++) difference |= hash.charCodeAt(i) ^ expected.charCodeAt(i);
    return difference === 0;
  };
  if (Date.parse(env.VUKOVA_IMPORT_EXPIRES_AT ?? "") > Date.now() && equal(env.VUKOVA_IMPORT_TOKEN_SHA256)) return "migration";
  const tokens = await getRawDb().prepare("SELECT id,token_hash FROM sheet_tokens WHERE id IN ('acassuso-attendance','members-rosters')").all<{id:string;token_hash:string}>();
  for (const token of tokens.results) if (equal(token.token_hash)) return token.id === "members-rosters" ? "members" : "attendance";
  return null;
}

async function runBatches(statements: D1PreparedStatement[]) {
  const db = getRawDb();
  for (let i = 0; i < statements.length; i += 75) await db.batch(statements.slice(i, i + 75));
}

function bulkStatements(prefix: string, tuples: (string | number | null)[][], suffix = "") {
  const statements: D1PreparedStatement[] = []; const db = getRawDb();
  if (!tuples.length) return statements;
  const width = tuples[0].length; const chunkSize = Math.floor(90 / width);
  for (let i = 0; i < tuples.length; i += chunkSize) {
    const chunk = tuples.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => `(${Array(width).fill("?").join(",")})`).join(",");
    statements.push(db.prepare(`${prefix} VALUES ${placeholders} ${suffix}`).bind(...chunk.flat()));
  }
  return statements;
}

export async function importSheet(body: Record<string, unknown>, access: ImportAccess) {
  if (body.kind === "corrections") {
    if (access !== "migration") throw new Error("Esta conexión no permite corregir identidades.");
    return reconcileSheets(body);
  }
  validateMatrix(body.rows);
  const rows = body.rows;
  const sheetId = Number(body.sheetId);
  const sheetName = String(body.sheetName ?? "").trim();
  if (!Number.isInteger(sheetId) || sheetId < 0 || !sheetName || sheetName.length > 150) throw new Error("Identificación de planilla inválida.");
  const db = getRawDb(); const now = new Date().toISOString();
  let id: string; let period: string; let count: number; let warnings: unknown; let branchId: string | null = null;
  const atomic: D1PreparedStatement[] = [];
  if (body.kind === "members") {
    if (access === "attendance") throw new Error("Esta conexión solo permite actualizar presentes.");
    const source = ROSTER_SOURCES.find(s => s.spreadsheetId === body.spreadsheetId && s.sheetId === sheetId && s.service === body.service);
    if (!source) throw new Error("Padrón no autorizado para esta importación.");
    if (access === "members" && source.year !== Number(localDay().slice(0,4))) throw new Error("Padrón no configurado para el año actual; revisá la conexión.");
    const service = source.service;
    const parsed = parseRoster(rows, service, localDay(), source);
    if (!parsed.length) throw new Error("Formato de padrón vacío: se conservan las fichas anteriores.");
    id = source.id; period = String(source.year); count = parsed.length;
    atomic.push(db.prepare("INSERT INTO branches (id, name, code, active) VALUES (?, ?, ?, 1) ON CONFLICT(id) DO NOTHING").bind(source.branchId, `Vukova ${source.branchName}`, source.branchCode));
    const memberTuples: (string | number | null)[][] = [];
    const rosterTuples: (string | number | null)[][] = [];
    const existing = await db.prepare("SELECT member_id,normalized_name,history_json,archived_at,missing_since FROM sheet_rosters WHERE source_spreadsheet_id=? AND source_sheet_id=? AND service=? ORDER BY source_row,member_id").bind(source.spreadsheetId, sheetId, service).all<{member_id:string;normalized_name:string;history_json:string;archived_at:string|null;missing_since:string|null}>();
    const active = existing.results.filter(r => !r.archived_at);
    const priorCount = active.filter(r => !r.missing_since).length;
    if (access === "members" && parsed.length < priorCount * 0.75) throw new Error("Formato de padrón: faltan más del 25% de las filas. Se conservan las fichas; revisá la planilla antes de reintentar.");
    const used = new Set<string>();
    const keys = new Set(parsed.map(r => r.key));
    const missing = active.filter(r => !keys.has(r.normalized_name));
    const ambiguous: {name:string;sourceRow:number}[] = [];
    const nameCounts = new Map<string,number>();
    for (const row of parsed) nameCounts.set(row.key,(nameCounts.get(row.key) ?? 0)+1);
    for (const row of parsed) {
      const candidates = active.filter(r => r.normalized_name === row.key);
      const exact = candidates.filter(r => !used.has(r.member_id) && r.history_json === JSON.stringify(row.history));
      // Moving rows never changes identity. Ambiguous homonyms require review,
      // rather than guessing from their current row number or overwriting history.
      const match = candidates.length === 1 && nameCounts.get(row.key) === 1 ? candidates[0] : exact.length === 1 ? exact[0] : null;
      if (candidates.length && !match) { ambiguous.push({name:row.name,sourceRow:row.sourceRow}); continue; }
      let memberId = match?.member_id ?? `sheet-${await sha256(`${source.spreadsheetId}:${sheetId}:${row.key}:${row.occurrence}`)}`;
      if (!match && existing.results.some(r => r.member_id === memberId)) memberId = `sheet-${crypto.randomUUID()}`;
      used.add(memberId);
      if (match) for (const event of changedMonthEvents(JSON.parse(match.history_json), row.history, localDay().slice(0, 7))) {
        atomic.push(db.prepare("INSERT INTO member_month_events (id,member_id,period,kind,observed_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING")
          .bind(`${memberId}:${event.period}:${event.kind}`, memberId, event.period, event.kind, now));
      }
      memberTuples.push([memberId, row.name, source.branchId, row.status, service, row.plan || null, now, now]);
      rosterTuples.push([memberId, memberId, sheetId, row.sourceRow, row.name, row.key, service, row.state, JSON.stringify(row.history), JSON.stringify(row.review), now, source.spreadsheetId, JSON.stringify(row.details)]);
    }
    warnings = { pendingReview: parsed.filter(p => p.review.length).length + missing.length, missing: missing.length, ambiguous, updated: memberTuples.length };
    atomic.push(...bulkStatements("INSERT INTO members (id,full_name,home_branch_id,status,service,plan_name,created_at,updated_at)", memberTuples, "ON CONFLICT(id) DO UPDATE SET full_name=excluded.full_name,status=excluded.status,plan_name=excluded.plan_name,updated_at=excluded.updated_at"));
    atomic.push(...bulkStatements("INSERT INTO sheet_rosters (id,member_id,source_sheet_id,source_row,source_name,normalized_name,service,source_state,history_json,review_json,imported_at,source_spreadsheet_id,source_details_json)", rosterTuples,
      "ON CONFLICT(id) DO UPDATE SET source_row=excluded.source_row,source_name=excluded.source_name,normalized_name=excluded.normalized_name,source_state=excluded.source_state,history_json=excluded.history_json,review_json=excluded.review_json,imported_at=excluded.imported_at,source_details_json=excluded.source_details_json,missing_since=NULL"));
    for (const row of missing) {
      atomic.push(db.prepare("UPDATE sheet_rosters SET missing_since=COALESCE(missing_since,?) WHERE member_id=?").bind(now,row.member_id));
      atomic.push(db.prepare("UPDATE members SET status='unconfirmed',updated_at=? WHERE id=?").bind(now,row.member_id));
    }
  } else if (body.kind === "attendance") {
    if (access === "members") throw new Error("Esta conexión solo permite actualizar socios.");
    const source = ATTENDANCE_SOURCES.find(s => s.spreadsheetId === body.spreadsheetId);
    if (!source || body.branchId !== undefined && body.branchId !== source.branchId) throw new Error("Planilla de presentes no autorizada.");
    const tab = attendanceTabPeriod(source, sheetName);
    if (!tab || tab.year !== Number(body.year) || tab.month !== Number(body.month)) throw new Error("Período y pestaña de presentes no coinciden.");
    const parsed = parseAttendance(rows, tab.year, tab.month, localDay(), source.dayStart);
    if (parsed.period > localDay().slice(0, 7)) throw new Error("No se pueden importar meses futuros.");
    branchId = source.branchId;
    atomic.push(db.prepare("INSERT INTO branches (id,name,code,active) VALUES (?,?,?,1) ON CONFLICT(id) DO NOTHING").bind(source.branchId,`Vukova ${source.branchName}`,source.branchId.replace(/^branch-/,"")));
    id = branchId === "branch-acassuso" ? `attendance-${parsed.period}` : `attendance-${branchId}-${parsed.period}`;
    period = parsed.period; count = parsed.entries.length; warnings = parsed.warnings;
    const version = crypto.randomUUID();
    // A snapshot is published with one atomic pointer switch. Readers never see
    // a partially imported month; concurrent/retried deliveries remain harmless.
    const tuples: (string | number | null)[][] = [];
    for (const row of parsed.entries) {
      const entryId = `${version}:${await sha256(`${row.key}:${row.date}`)}`;
      tuples.push([entryId, id, row.key, row.name, row.date, row.marker, JSON.stringify(row.sourceRows), version]);
    }
    await runBatches(bulkStatements("INSERT INTO sheet_attendance (id,import_id,normalized_name,source_name,attended_on,marker,source_rows_json,version)", tuples));
    warnings = { ...parsed.warnings, version };
  } else throw new Error("Tipo de importación inválido.");
  atomic.push(db.prepare(`INSERT INTO sheet_imports (id, branch_id, kind, sheet_name, spreadsheet_id, sheet_id, period, record_count, review_json, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET branch_id=excluded.branch_id, sheet_name=excluded.sheet_name, sheet_id=excluded.sheet_id,
    record_count=excluded.record_count, review_json=excluded.review_json, synced_at=excluded.synced_at`).bind(id, branchId, body.kind, sheetName, String(body.spreadsheetId), sheetId, period, count, JSON.stringify(warnings), now));
  if (access !== "migration") atomic.push(db.prepare("UPDATE sheet_tokens SET last_used_at=? WHERE id=?").bind(now, access === "members" ? "members-rosters" : "acassuso-attendance"));
  // Publish the entire member update and its receipt atomically.
  await db.batch(atomic);
  if (body.kind === "attendance") {
    // Retain the last day of snapshots. Never collect a concurrent import.
    try {
      await db.prepare(`DELETE FROM sheet_attendance WHERE import_id=? AND datetime(created_at)<datetime('now','-1 day')
        AND version<>(SELECT json_extract(review_json,'$.version') FROM sheet_imports WHERE id=?)`).bind(id,id).run();
    } catch { console.warn("sheet_snapshot_cleanup_deferred"); }
  }
  return { ok: true, kind: body.kind, period, records: count, warnings, syncedAt: now };
}
