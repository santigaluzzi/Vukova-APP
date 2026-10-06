export const ACASSUSO_BRANCH = "branch-acassuso";
export const ROSTER_FILE = "1uGZ-DU16NWo6PpI1xrtMEDMUAFoWAG1KdVfYDqCuU8s";
export const ATTENDANCE_FILE = "1wv6dOBXkbds30CZG0TnmNY7591s_uie6nxDSsxtKDCU";
export const ROSTER_TABS = { gym: 683005756, pool: 1044422250 } as const;
export type SheetMatrix = (string | number | boolean | null)[][];
export type SourceMonth = { period: string; amount: string; state: string; date: string; plan: string; installment: string };
export function normalizeName(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
export function localDay() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}
function cell(value: unknown) { return String(value ?? "").trim(); }
export function validateMatrix(value: unknown): asserts value is SheetMatrix {
  if (!Array.isArray(value) || value.length < 2 || value.length > 3000 || value.some(r => !Array.isArray(r) || r.length > 100 || r.some(v => v !== null && !["string", "number", "boolean"].includes(typeof v)) || r.some(v => String(v ?? "").length > 1000))) throw new Error("Formato de planilla inválido.");
}
export function parseRoster(rows: SheetMatrix, service: "gym" | "pool", asOf = localDay(), layout?: { monthStart: number; year: number; swapDecember?: boolean; blankIsInactive?: boolean; nameHeader?: string; detailColumns?: Record<string, number>; ignoredNames?: string[] }) {
  const expectedNameHeader = normalizeName(layout?.nameHeader ?? "ALUMNOS");
  if (normalizeName(rows[0]?.[0]) !== expectedNameHeader) throw new Error("Falta el encabezado ALUMNOS del padrón.");
  const start = layout?.monthStart ?? (service === "gym" ? 5 : 3);
  if (normalizeName(rows[0][start]) !== "ENERO" || normalizeName(rows[0][start + 40]) !== "SEPTIEMBRE") throw new Error("La estructura del padrón cambió; revisá las columnas.");
  if (layout) {
    const months = ["ENERO","FEBRERO","MARZO","ABRIL","MAYO","JUNIO","JULIO","AGOSTO","SEPTIEMBRE","OCTUBRE","NOVIEMBRE","DICIEMBRE"];
    for (let month = 0; month < 12; month++) {
      const expected = layout.swapDecember && month === 11 ? [months[month],"ESTADO","PLAN","FECHA","CUOTA"] : [months[month],"ESTADO","FECHA","PLAN","CUOTA"];
      if (expected.some((label,i) => normalizeName(rows[0][start+month*5+i]) !== label)) throw new Error("La estructura del padrón cambió; revisá las columnas antes de sincronizar.");
    }
  }
  const normalized = rows.slice(1).map(r => normalizeName(r[0]));
  const duplicates = new Set(normalized.filter((n, i) => n && normalized.indexOf(n) !== i));
  const seen = new Map<string, number>();
  return rows.slice(1).flatMap((r, i) => {
    const name = cell(r[0]); const key = normalizeName(name);
    if (!key || layout?.ignoredNames?.includes(key)) return [];
    const occurrence = (seen.get(key) ?? 0) + 1; seen.set(key, occurrence);
    const history: SourceMonth[] = Array.from({ length: 12 }, (_, month) => {
      const offset = start + month * 5;
      // Pool December swaps the date and plan columns in the source.
      const swapped = (layout ? layout.swapDecember : service === "pool") && month === 11;
      return { period: `${layout?.year ?? 2026}-${String(month + 1).padStart(2, "0")}`, amount: cell(r[offset]), state: cell(r[offset + 1]).toUpperCase(), date: cell(r[offset + (swapped ? 3 : 2)]), plan: cell(r[offset + (swapped ? 2 : 3)]), installment: cell(r[offset + 4]) };
    });
    const current = history.find(h => h.period === asOf.slice(0, 7));
    const state = current?.state ?? "";
    const review: string[] = [];
    if (duplicates.has(key)) review.push("Nombre repetido en la misma planilla; verificar identidad.");
    if (!key.includes(" ")) review.push("Nombre incompleto.");
    if (state && !["A", "N", "R", "B"].includes(state)) review.push(`Estado ${state} sin equivalencia confirmada.`);
    const plan = current?.plan || [...history].reverse().find(h => h.period <= asOf.slice(0, 7) && h.plan)?.plan || "";
    const details = Object.fromEntries(Object.entries(layout?.detailColumns ?? {}).map(([label, col]) => [label, cell(r[col])]));
    const status = ["A", "N"].includes(state) ? "active" : state === "B" || !state ? "inactive" : state === "R" ? "renewal" : "unconfirmed";
    return [{ name, key, occurrence, sourceRow: i + 6, history, state, plan, review, details, status }];
  });
}
export function parseAttendance(rows: SheetMatrix, year: number, month: number, asOf = localDay(), dayStart = 2) {
  if (!Number.isInteger(year) || year < 2026 || year > Number(asOf.slice(0, 4)) || !Number.isInteger(month) || month < 1 || month > 12) throw new Error("Período de asistencias inválido.");
  if (!["ALUMNOS","APELLIDO Y NOMBRE","DIAS",""].includes(normalizeName(rows[2]?.[0])) || dayStart === 3 && !["CONTACTO",""].includes(normalizeName(rows[2]?.[2]))) throw new Error("La estructura de presentes cambió; revisá los encabezados.");
  if (dayStart === 2 && !["TOTAL",""].includes(normalizeName(rows[2]?.[1])) || dayStart === 3 && !normalizeName(rows[2]?.[1]).startsWith("ASISTENCIAS MENSUALES")) throw new Error("La estructura de presentes cambió; revisá los encabezados.");
  const period = `${year}-${String(month).padStart(2, "0")}`;
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const invalidDays: {sourceRow:number;name:string;day:number;marker:string}[] = [];
  const calendarHeaders=rows[2].slice(dayStart,dayStart+maxDay);
  const completeCalendar=calendarHeaders.length===maxDay && calendarHeaders.every((v,i)=>Number(v)===i+1);
  const days = rows[2].slice(dayStart).map((v,col) => {
    if (!cell(v)) return null;
    // Vilo uses X in the unused slots after February 28. Infer a slot only
    // after a complete ordered calendar; an X within real dates is invalid.
    const day=cell(v).toUpperCase()==="X" && completeCalendar && col>=maxDay && col<31 ? col+1 : Number(v);
    if (Number.isInteger(day) && day>maxDay && day<=31) {
      rows.slice(3).forEach((r,i)=>{
        const marker=cell(r[dayStart+col]);
        if (/^(?:[1-9]\d*|p)$/i.test(marker)) invalidDays.push({sourceRow:i+4,name:cell(r[0]),day,marker});
      });
      return null;
    }
    return day;
  });
  const definedDays = days.filter((d): d is number => d !== null);
  if (!definedDays.length || new Set(definedDays).size !== definedDays.length || definedDays.some(d => !Number.isInteger(d) || d < 1 || d > maxDay)) throw new Error("Los días del mes no son válidos.");
  const entries = new Map<string, { key: string; name: string; date: string; marker: string; sourceRows: number[] }>();
  let duplicates = 0; let future = 0; let unknownMarks = 0;
  const unassigned: { sourceRow: number; date: string; marker: string }[] = [];
  for (const [i, r] of rows.slice(3).entries()) {
    const name = cell(r[0]); const key = normalizeName(name);
    for (const [col, day] of days.entries()) {
      const rawMarker = cell(r[col + dayStart]);
      const marker = /^p$/i.test(rawMarker) ? "1" : rawMarker;
      // Free-text absence notes are not attendance and are not imported.
      if (day === null || !/^\d+$/.test(marker) || Number(marker) === 0) continue;
      const date = `${period}-${String(day).padStart(2, "0")}`;
      if (date > asOf) { future++; continue; }
      if (!key) { unassigned.push({ sourceRow: i + 4, date, marker }); continue; }
      if (marker !== "1") unknownMarks++;
      const id = `${key}:${date}`; const previous = entries.get(id);
      if (previous) {
        duplicates++; previous.sourceRows.push(i + 4);
        if (previous.marker !== marker) previous.marker = "conflicto";
      } else entries.set(id, { key, name, date, marker, sourceRows: [i + 4] });
    }
  }
  return { period, entries: [...entries.values()], warnings: { duplicates, future, unknownMarks, unassigned, invalidDays } };
}
