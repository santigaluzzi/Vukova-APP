import { ATTENDANCE_FILE } from "./sheet-data";

export type AttendanceSource = { spreadsheetId: string; branchId: string; branchName: string; year: number; dayStart: number; namePattern: RegExp };

// These are the five reviewed attendance workbooks. A script token cannot
// submit an arbitrary spreadsheet as attendance for a different branch.
export const ATTENDANCE_SOURCES: AttendanceSource[] = [
  { spreadsheetId: ATTENDANCE_FILE, branchId: "branch-acassuso", branchName: "Acassuso", year: 2026, dayStart: 2, namePattern: /^PT\s+(.+?)\s+(\d{2}|\d{4})$/i },
  { spreadsheetId: "1SEvFBSdIdvGCdZuyNH3Q72BU64zLfa1UqqIMGwe1O8A", branchId: "branch-victoria", branchName: "Victoria", year: 2026, dayStart: 3, namePattern: /^(.+?)(?:\s+(\d{2}|\d{4}))?$/i },
  { spreadsheetId: "15QClU_55l0JZT8ScxAFXM_k5lyTOwUsBljAAMYCDMuI", branchId: "branch-delta", branchName: "Delta", year: 2026, dayStart: 3, namePattern: /^(.+?)(?:\s+(\d{2}|\d{4}))?$/i },
  { spreadsheetId: "1orBgW7qi8YOZaIETU92MTyJoRzDzyXVVJyixjmx51jk", branchId: "branch-olivos", branchName: "Olivos", year: 2026, dayStart: 2, namePattern: /^(.+?)(?:\s*(\d{2}|\d{4}))?$/i },
  { spreadsheetId: "1PbVrb_eNU28ZX79CF9ab-VPrwv8g7joIKcArEPVZcy4", branchId: "branch-vilo", branchName: "Vilo", year: 2026, dayStart: 2, namePattern: /^(.+?)\s+(\d{2}|\d{4})[´'’]?$/i },
];

const MONTHS: Record<string, number> = { ENE:1, FEB:2, MAR:3, ABR:4, MAY:5, JUN:6, JUL:7, AGO:8, SEP:9, SET:9, OCT:10, NOV:11, DIC:12 };
export function attendanceTabPeriod(source: AttendanceSource, name: string) {
  const match = name.trim().normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase().match(source.namePattern);
  if (!match) return null;
  const month = MONTHS[match[1].slice(0, 3)];
  const year = match[2] ? Number(match[2]) + (match[2].length === 2 ? 2000 : 0) : source.year;
  return month && year === source.year ? {year, month, period:`${year}-${String(month).padStart(2,"0")}`} : null;
}

export function attendanceSyncSources() {
  return ATTENDANCE_SOURCES.map(({spreadsheetId,branchId,branchName,year,dayStart})=>({spreadsheetId,branchId,branchName,year,dayStart}));
}
