import { getRawDb } from "@/db";
import { sha256 } from "@/lib/auth-security";
import { ACASSUSO_BRANCH, normalizeName, type SourceMonth } from "@/lib/sheet-data";

type Rename = { memberId: string; expectedName: string; name: string };
type Archive = { memberId: string; expectedName: string };
type Alias = { name: string; memberId: string };
type Roster = { member_id: string; source_name: string; normalized_name: string; service: string; history_json: string; review_json: string; status: string; full_name: string };
function invalid(reason: string): never { throw new Error(`Formato de corrección inválido: ${reason}`); }
function validName(value: unknown): value is string { return typeof value === "string" && value.length <= 150 && normalizeName(value).length > 0; }

// Only the expiring migration credential can reach this function. All mutations
// are structured, bounded, transactional and keep a copy of the prior records.
export async function reconcileSheets(body: Record<string, unknown>) {
  if (typeof body.id !== "string" || !/^[a-z0-9-]{6,100}$/.test(body.id)) invalid("identificador");
  for (const key of ["renames", "archives", "aliases", "activeNames"]) if (!Array.isArray(body[key])) invalid("listas requeridas");
  const renames = body.renames as Rename[]; const archives = body.archives as Archive[];
  const aliases = body.aliases as Alias[]; const activeNames = body.activeNames as string[];
  if (renames.length + archives.length + aliases.length + activeNames.length > 100) invalid("demasiados cambios");
  if (renames.some(r => !r || !validName(r.memberId) || !validName(r.expectedName) || !validName(r.name)) || archives.some(r => !r || !validName(r.memberId) || !validName(r.expectedName)) || aliases.some(r => !r || !validName(r.memberId) || !validName(r.name)) || activeNames.some(n => !validName(n))) invalid("nombres o referencias");
  const db = getRawDb(); const hash = await sha256(JSON.stringify(body));
  const previous = await db.prepare("SELECT payload_hash FROM sheet_corrections WHERE id=?").bind(body.id).first<{payload_hash:string}>();
  if (previous) { if (previous.payload_hash !== hash) invalid("el identificador ya tiene otros cambios"); return {ok:true, kind:"corrections", alreadyApplied:true}; }
  const roster = await db.prepare(`SELECT r.member_id,r.source_name,r.normalized_name,r.service,r.history_json,r.review_json,m.status,m.full_name
    FROM sheet_rosters r JOIN members m ON m.id=r.member_id WHERE m.home_branch_id=? AND r.archived_at IS NULL`).bind(ACASSUSO_BRANCH).all<Roster>();
  const byId = new Map(roster.results.map(r => [r.member_id,r])); const changed = new Set<string>();
  const before: Roster[] = []; const statements: D1PreparedStatement[] = []; const now = new Date().toISOString();
  const finalNames = new Map(roster.results.map(r => [r.member_id,r.normalized_name]));
  const allAliases = [...aliases];
  for (const operation of [...renames, ...archives]) {
    const row = byId.get(operation.memberId);
    if (!row || row.normalized_name !== normalizeName(operation.expectedName) || changed.has(operation.memberId)) invalid("la ficha de origen cambió");
    changed.add(operation.memberId); before.push({...row});
  }
  for (const change of renames) {
    const row = byId.get(change.memberId)!; const key = normalizeName(change.name);
    if (roster.results.some(r => r.member_id !== row.member_id && r.service === row.service && r.normalized_name === key)) invalid("el nombre de destino ya existe");
    finalNames.set(row.member_id,key);
    statements.push(db.prepare("UPDATE members SET full_name=?,updated_at=? WHERE id=?").bind(change.name.trim(),now,row.member_id));
    statements.push(db.prepare("UPDATE sheet_rosters SET source_name=?,normalized_name=? WHERE member_id=?").bind(change.name.trim(),key,row.member_id));
    if (row.service === "gym" && row.normalized_name !== key) allAliases.push({name:row.source_name,memberId:row.member_id});
  }
  for (const change of archives) {
    const row = byId.get(change.memberId)!; const history = JSON.parse(row.history_json) as SourceMonth[];
    if (history.some(h => h.amount || h.state || h.date || h.plan || h.installment)) invalid("no se puede archivar una ficha con historial");
    if (!roster.results.some(r => r.member_id !== row.member_id && r.service === row.service && r.normalized_name === row.normalized_name && !archives.some(a => a.memberId === r.member_id))) invalid("falta la ficha conservada del duplicado");
    const refs = await db.prepare(`SELECT (SELECT COUNT(*) FROM payments WHERE member_id=?)+(SELECT COUNT(*) FROM attendance WHERE member_id=?)+
      (SELECT COUNT(*) FROM sheet_name_links WHERE member_id=?)+(SELECT COUNT(*) FROM sheet_member_aliases WHERE member_id=?) AS n`).bind(row.member_id,row.member_id,row.member_id,row.member_id).first<{n:number}>();
    if (refs?.n) invalid("el duplicado tiene registros vinculados");
    finalNames.delete(row.member_id);
    statements.push(db.prepare("UPDATE members SET status='archived',updated_at=? WHERE id=?").bind(now,row.member_id));
    statements.push(db.prepare("UPDATE sheet_rosters SET archived_at=? WHERE member_id=?").bind(now,row.member_id));
  }
  const existingAliases = await db.prepare("SELECT normalized_name,member_id FROM sheet_member_aliases UNION ALL SELECT normalized_name,member_id FROM sheet_name_links").all<{normalized_name:string;member_id:string}>();
  const aliasIds = new Map<string,string>();
  for (const alias of allAliases) {
    const key = normalizeName(alias.name); const target = byId.get(alias.memberId);
    if (!target || target.service !== "gym" || !finalNames.has(alias.memberId)) invalid("destino del vínculo");
    if ([...finalNames].some(([id,n]) => n === key && byId.get(id)?.service === "gym" && id !== alias.memberId) || existingAliases.results.some(a => a.normalized_name === key && a.member_id !== alias.memberId) || (aliasIds.has(key) && aliasIds.get(key) !== alias.memberId)) invalid("vínculo ambiguo");
    aliasIds.set(key,alias.memberId);
  }
  for (const [key,id] of aliasIds) statements.push(db.prepare("INSERT INTO sheet_member_aliases (normalized_name,member_id,recorded_at) VALUES (?,?,?) ON CONFLICT(normalized_name) DO NOTHING").bind(key,id,now));
  const knownNames = await db.prepare(`SELECT DISTINCT a.normalized_name FROM sheet_attendance a JOIN sheet_imports i ON i.id=a.import_id AND a.version=json_extract(i.review_json,'$.version')`).all<{normalized_name:string}>();
  const attendanceNames = new Set(knownNames.results.map(n => n.normalized_name)); const active = new Map(activeNames.map(n => [normalizeName(n),n.trim()]));
  for (const [key,name] of active) {
    if (!attendanceNames.has(key)) invalid("el asistente no figura en presentes");
    if ([...finalNames].some(([id,n]) => n === key && byId.get(id)?.service === "gym") || aliasIds.has(key) || existingAliases.results.some(a => a.normalized_name === key)) invalid("el asistente ya tiene una ficha vinculada");
    statements.push(db.prepare("INSERT INTO sheet_active_visitors (normalized_name,source_name,status,declared_at) VALUES (?,?,'active',?) ON CONFLICT(normalized_name) DO UPDATE SET source_name=excluded.source_name,status='active',declared_at=excluded.declared_at").bind(key,name,now));
  }
  statements.push(db.prepare("INSERT INTO sheet_corrections (id,payload_hash,changes_json,applied_at) VALUES (?,?,?,?)").bind(body.id,hash,JSON.stringify({request:body,before}),now));
  await db.batch(statements);
  return {ok:true,kind:"corrections",renamed:renames.length,archived:archives.length,aliases:aliasIds.size,activeOtherBranch:active.size,appliedAt:now};
}
