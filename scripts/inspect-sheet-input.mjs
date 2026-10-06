import { readFileSync } from "node:fs";
import { parseRoster, parseAttendance } from "../lib/sheet-data.ts";
const payloads = JSON.parse(readFileSync(process.argv[2],"utf8"));
let total = 0;
for (const p of payloads) {
  if (p.kind === "members") { const rows = parseRoster(p.rows,p.service); console.log(JSON.stringify({sheet:p.sheetName,records:rows.length,review:rows.filter(r=>r.review.length).length})); }
  else { const parsed = parseAttendance(p.rows,p.year,p.month); const confirmed=parsed.entries.filter(r=>r.marker==="1").length;total+=confirmed; console.log(JSON.stringify({period:parsed.period,records:parsed.entries.length,confirmed,warnings:parsed.warnings})); }
}
console.log(JSON.stringify({confirmedAttendanceTotal:total}));
