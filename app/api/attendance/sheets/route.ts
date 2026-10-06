import { getRawDb } from "@/db";
import { sheetViewer } from "@/lib/sheet-views";
import { localDay, normalizeName, type SourceMonth } from "@/lib/sheet-data";
import { buildAttendanceAnalytics, type AttendancePerson } from "@/lib/attendance-analytics";
import { attendanceIdentity, attendanceJoins } from "@/lib/attendance-queries";
import { effectiveBranchFilter } from "@/lib/branch-filter";

type ImportRow = {id:string;branchId:string;period:string;recordCount:number;syncedAt:string;sheetName:string;sheetId:number;spreadsheetId:string;reviewJson:string};

export async function GET(request: Request) {
  const access = await sheetViewer("attendance.manage", "members"); if (access.error) return access.error;
  const branchSelection = effectiveBranchFilter(new URL(request.url).searchParams.get("branch"), access.viewer!.branchScope);
  if ("error" in branchSelection) return Response.json({ error: branchSelection.error }, { status: branchSelection.status });
  const ids=branchSelection.branchIds;
  const where=ids.map(()=>"?").join(",");
  try {
    const db=getRawDb();
    const imports=await db.prepare(`SELECT id,branch_id AS branchId,period,record_count AS recordCount,synced_at AS syncedAt,sheet_name AS sheetName,sheet_id AS sheetId,spreadsheet_id AS spreadsheetId,review_json AS reviewJson FROM sheet_imports WHERE kind='attendance' AND branch_id IN (${where}) ORDER BY period DESC`).bind(...ids).all<ImportRow>();
    const periodsMap=new Map<string,{period:string;syncedAt:string}>();
    for (const row of imports.results) {
      const old=periodsMap.get(row.period);
      if (!old || old.syncedAt<row.syncedAt) periodsMap.set(row.period,{period:row.period,syncedAt:row.syncedAt});
    }
    const manualPeriods=await db.prepare(`SELECT substr(date(checked_in_at,'-3 hours'),1,7) AS period,
      max(checked_in_at) AS syncedAt FROM attendance WHERE branch_id IN (${where})
      GROUP BY substr(date(checked_in_at,'-3 hours'),1,7)`).bind(...ids).all<{period:string;syncedAt:string}>();
    for(const row of manualPeriods.results) {
      const old=periodsMap.get(row.period);
      if(!old||old.syncedAt<row.syncedAt)periodsMap.set(row.period,row);
    }
    const periods=[...periodsMap.values()].sort((a,b)=>b.period.localeCompare(a.period));
    const requested=new URL(request.url).searchParams.get("period");
    const period=periods.find(p=>p.period===requested)?.period ?? periods[0]?.period;
    if (!period) return Response.json({periods:[],rows:[],selected:null,viewBranch:branchSelection.branchId});
    const current=imports.results.filter(i=>i.period===period);
    const warnings=current.map(i=>({branchId:i.branchId,...JSON.parse(i.reviewJson)}));
    const selected={period,syncedAt:periodsMap.get(period)!.syncedAt,recordCount:current.reduce((n,r)=>n+r.recordCount,0),warnings:{
      unassigned:warnings.flatMap(w=>(w.unassigned??[]).map((u:{sourceRow:number;date:string;marker:string})=>({...u,branchId:w.branchId}))),
      invalidDays:warnings.flatMap(w=>(w.invalidDays??[]).map((u:{sourceRow:number;name:string;day:number;marker:string})=>({...u,branchId:w.branchId}))),
      duplicates:warnings.reduce((n,w)=>n+(w.duplicates??0),0),unknownMarks:warnings.reduce((n,w)=>n+(w.unknownMarks??0),0),future:warnings.reduce((n,w)=>n+(w.future??0),0),
    },sources:current.map(i=>({branchId:i.branchId,spreadsheetId:i.spreadsheetId,sheetName:i.sheetName}))};
    const result=await db.prepare(`SELECT i.branch_id AS branchId,a.source_name AS name,a.normalized_name AS normalizedName,a.attended_on AS date,a.marker,
      a.source_rows_json AS sourceRowsJson,${attendanceIdentity} AS memberId,m.full_name AS memberName,
      CASE WHEN m.id IS NULL THEN v.status ELSE m.status END AS memberStatus,
      CASE WHEN m.home_branch_id<>i.branch_id OR (m.id IS NULL AND v.normalized_name IS NOT NULL) THEN 1 ELSE 0 END AS otherBranch
      FROM sheet_attendance a JOIN sheet_imports i ON i.id=a.import_id AND a.version=json_extract(i.review_json,'$.version') ${attendanceJoins}
      LEFT JOIN members m ON m.id=${attendanceIdentity}
      LEFT JOIN sheet_active_visitors v ON i.branch_id='branch-acassuso' AND v.normalized_name=a.normalized_name
      WHERE i.period=? AND i.branch_id IN (${where}) ORDER BY a.normalized_name,a.attended_on`).bind(period,...ids).all();
    const grouped=new Map<string,AttendancePerson>();
    for (const r of result.results) {
      const key=r.memberId?`member:${r.memberId}`:`${r.branchId}:${r.normalizedName}`;
      let row=grouped.get(key);
      if (!row) {row={name:String(r.name),normalizedName:String(r.normalizedName),sourceNames:[],branchId:String(r.branchId),memberId:r.memberId?String(r.memberId):null,memberName:r.memberName?String(r.memberName):null,memberStatus:r.memberStatus?String(r.memberStatus):null,otherBranch:!!r.otherBranch,dates:[],reviewDates:[],duplicates:0};grouped.set(key,row);}
      if (!row.sourceNames.includes(String(r.name))) row.sourceNames.push(String(r.name));
      if (r.marker==="1") {if(row.dates.includes(String(r.date))) row.duplicates++;else row.dates.push(String(r.date));}
      else if (!row.reviewDates.includes(`${r.date} (marca ${r.marker})`)) row.reviewDates.push(`${r.date} (marca ${r.marker})`);
      if (JSON.parse(String(r.sourceRowsJson)).length>1) row.duplicates++;
    }
    const manual=await db.prepare(`SELECT a.member_id AS memberId,a.branch_id AS branchId,
      date(a.checked_in_at,'-3 hours') AS date,m.full_name AS name,m.status,m.home_branch_id AS homeBranchId
      FROM attendance a JOIN members m ON m.id=a.member_id WHERE a.branch_id IN (${where})
      AND date(a.checked_in_at,'-3 hours')>=? AND date(a.checked_in_at,'-3 hours')<=?
      ORDER BY a.checked_in_at`).bind(...ids,`${period}-01`,`${period}-31`).all<{
        memberId:string;branchId:string;date:string;name:string;status:string;homeBranchId:string
      }>();
    for(const m of manual.results) {
      const key=`member:${m.memberId}`;
      let row=grouped.get(key);
      if(!row) {
        row={name:m.name,normalizedName:normalizeName(m.name),sourceNames:[],branchId:m.branchId,
          memberId:m.memberId,memberName:m.name,memberStatus:m.status,otherBranch:m.homeBranchId!==m.branchId,
          dates:[],reviewDates:[],duplicates:0};
        grouped.set(key,row);
      }
      if(!row.dates.includes(m.date))row.dates.push(m.date);
    }
    Object.assign(selected,{manualToday:manual.results.filter(m=>m.date===localDay()).length});
    for(const row of grouped.values()) row.dates.sort();
    let analytics;
    if (new URL(request.url).searchParams.get("analytics")==="1") {
      const [roster,visitors,counts]=await Promise.all([
        db.prepare(`SELECT m.id,m.full_name AS name,m.home_branch_id AS branchId,r.normalized_name AS normalizedName,r.history_json AS historyJson,r.review_json AS reviewJson
          FROM members m JOIN sheet_rosters r ON r.member_id=m.id WHERE m.home_branch_id IN (${where}) AND r.service='gym' AND r.archived_at IS NULL AND r.missing_since IS NULL`).bind(...ids).all<{id:string;name:string;branchId:string;normalizedName:string;historyJson:string;reviewJson:string}>(),
        ids.includes("branch-acassuso")?db.prepare(`SELECT v.source_name AS name,v.normalized_name AS normalizedName,v.declared_at AS declaredAt FROM sheet_active_visitors v WHERE v.status='active'
          AND NOT EXISTS(SELECT 1 FROM sheet_rosters r WHERE r.normalized_name=v.normalized_name AND r.service='gym' AND r.archived_at IS NULL)
          AND NOT EXISTS(SELECT 1 FROM sheet_name_links l WHERE l.normalized_name=v.normalized_name)
          AND NOT EXISTS(SELECT 1 FROM sheet_member_aliases n WHERE n.normalized_name=v.normalized_name)`).all<{name:string;normalizedName:string;declaredAt:string}>():Promise.resolve({results:[] as {name:string;normalizedName:string;declaredAt:string}[]}),
        db.prepare(`WITH visits AS (
          SELECT a.attended_on AS day,CASE WHEN ${attendanceIdentity} IS NOT NULL THEN 'member:'||${attendanceIdentity}
            ELSE i.branch_id||':'||a.normalized_name END AS person
          FROM sheet_attendance a JOIN sheet_imports i ON i.id=a.import_id AND a.version=json_extract(i.review_json,'$.version') ${attendanceJoins}
          WHERE a.marker='1' AND i.branch_id IN (${where}) AND i.period>=? AND i.period<=?
          UNION ALL SELECT date(checked_in_at,'-3 hours'),'member:'||member_id FROM attendance
          WHERE branch_id IN (${where}) AND date(checked_in_at,'-3 hours')>=? AND date(checked_in_at,'-3 hours')<=?
        ) SELECT day AS date,COUNT(DISTINCT person) AS total FROM visits GROUP BY day ORDER BY day`)
          .bind(...ids,`${period.slice(0,4)}-01`,period,...ids,`${period.slice(0,4)}-01`,`${period}-31`).all<{date:string;total:number}>(),
      ]);
      const cohort=roster.results.map(r=>({id:r.id,name:r.name,normalizedName:r.normalizedName,branchId:r.branchId,state:(JSON.parse(r.historyJson) as SourceMonth[]).find(h=>h.period===period)?.state??"",review:JSON.parse(r.reviewJson) as string[]}));
      analytics=buildAttendanceAnalytics({period,syncedAt:selected.syncedAt,today:localDay(),rows:[...grouped.values()],cohort,visitors:visitors.results,periods,counts:counts.results});
    }
    return Response.json({periods,selected,rows:[...grouped.values()],analytics,viewBranch:branchSelection.branchId});
  } catch {console.error("sheet_attendance_read_failed");return Response.json({error:"No se pudieron cargar las asistencias."},{status:500});}
}
