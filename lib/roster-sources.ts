export type RosterSource = {
  id: string; spreadsheetId: string; sheetId: number; sheetName: string;
  branchId: string; branchName: string; branchCode: string;
  service: "gym" | "pool"; year: number; monthStart: number; columns: number;
  swapDecember?: boolean; blankIsInactive?: boolean; nameHeader?: string; detailColumns?: Record<string, number>; ignoredNames?: string[];
};

// Only these reviewed sources can update members. Sheet tab IDs are not global.
export const ROSTER_SOURCES: RosterSource[] = [
  { id: "roster-gym", spreadsheetId: "1uGZ-DU16NWo6PpI1xrtMEDMUAFoWAG1KdVfYDqCuU8s", sheetId: 683005756, sheetName: "GYM 2026", branchId: "branch-acassuso", branchName: "Acassuso", branchCode: "acassuso", service: "gym", year: 2026, monthStart: 5, columns: 65 },
  { id: "roster-pool", spreadsheetId: "1uGZ-DU16NWo6PpI1xrtMEDMUAFoWAG1KdVfYDqCuU8s", sheetId: 1044422250, sheetName: "2026 PILE", branchId: "branch-acassuso", branchName: "Acassuso", branchCode: "acassuso", service: "pool", year: 2026, monthStart: 3, columns: 63, swapDecember: true },
  { id: "roster-delta-gym", spreadsheetId: "13eIVoQBNw1J3gDyH6QtTHZeVVX8JFeB9bYnO5dhTN0o", sheetId: 571533148, sheetName: "2026", branchId: "branch-delta", branchName: "Delta", branchCode: "delta", service: "gym", year: 2026, monthStart: 4, columns: 64, detailColumns: { "Descuento": 1, "Fecha de inicio registrada": 2, "Día registrado": 3 } },
  { id: "roster-vilo-gym", spreadsheetId: "155uCc1YiQKFQ1ZLO3fE5_e3Sh9Vwe_Rr8f0tJjMprcg", sheetId: 1748120142, sheetName: "CS 2026", branchId: "branch-vilo", branchName: "Vilo", branchCode: "vilo", service: "gym", year: 2026, monthStart: 3, columns: 63, detailColumns: { "Fecha de inicio registrada": 1, "Fecha de pago registrada": 2 }, ignoredNames: ["TOTAL INGRESOS"] },
  { id: "roster-olivos-gym", spreadsheetId: "12CZ1c9iHo_cPAaLuxglXf0fQJK8ln6mYlkBhzt4sdtI", sheetId: 1556718027, sheetName: "CS 2026", branchId: "branch-olivos", branchName: "Olivos", branchCode: "olivos", service: "gym", year: 2026, monthStart: 4, columns: 64, blankIsInactive: true, detailColumns: { "Fecha de inicio registrada": 1, "Fecha de pago registrada": 2, "Certificado médico": 3 }, ignoredNames: ["TOTAL INGRESOS"] },
  { id: "roster-victoria-gym", spreadsheetId: "12LYj9lBjSRCA9osfPuxtnuNYzFRQaq0qP420kAKTxt8", sheetId: 92222996, sheetName: "2026", branchId: "branch-victoria", branchName: "Victoria", branchCode: "victoria", service: "gym", year: 2026, monthStart: 5, columns: 65, nameHeader: "", detailColumns: { "Descuento": 1, "Certificado médico": 2, "Fecha de inicio registrada": 3 } },
];

export function rosterSyncSources() {
  return ROSTER_SOURCES.map(s => ({spreadsheetId:s.spreadsheetId,sheetId:s.sheetId,service:s.service,columns:s.columns,label:`${s.branchName} · ${s.sheetName}`}));
}
