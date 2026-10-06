export function membersScript(origin: string, token: string | null) {
  return `// Proyecto privado: sincronización de los controles de socios de Vukova.
// ${token ? "Pegá todo el código en un proyecto NUEVO" : "Reemplazá el código en el MISMO proyecto de socios que ya está instalado"} y ejecutá instalarSociosVukova.
// Lee las planillas sin modificarlas. Las sedes se consultan en Vukova cada hora.
const VUKOVA_SOCIOS_URL = ${JSON.stringify(origin)};
const VUKOVA_SOCIOS_CLAVE = ${JSON.stringify(token ?? "")};

function instalarSociosVukova() {
  const props = PropertiesService.getScriptProperties();
  const key = VUKOVA_SOCIOS_CLAVE || props.getProperty("VUKOVA_SOCIOS_CLAVE");
  if (!key) throw new Error("Este código reutiliza la conexión instalada: pegalo en el mismo proyecto de socios. Si no tenés ese proyecto, creá una conexión nueva desde Vukova.");
  props.setProperties({VUKOVA_SOCIOS_URL:VUKOVA_SOCIOS_URL,VUKOVA_SOCIOS_CLAVE:key});
  sincronizarSociosVukova();
  ScriptApp.getProjectTriggers().filter(function(t) { return t.getHandlerFunction() === "sincronizarSociosVukova"; }).forEach(function(t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("sincronizarSociosVukova").timeBased().everyHours(1).create();
  console.log("Socios sincronizados. Actualización automática instalada cada hora.");
}

function sincronizarSociosVukova() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const url = props.getProperty("VUKOVA_SOCIOS_URL");
    const key = props.getProperty("VUKOVA_SOCIOS_CLAVE");
    if (!url || !key) throw new Error("Primero ejecutá instalarSociosVukova.");
    const configResponse = UrlFetchApp.fetch(url + "/api/imports/sheets", {method:"get",headers:{Authorization:"Bearer " + key},muteHttpExceptions:true});
    if (configResponse.getResponseCode() !== 200) throw new Error("No se pudieron consultar las sedes: " + configResponse.getContentText());
    const sources = JSON.parse(configResponse.getContentText()).sources;
    if (!Array.isArray(sources) || !sources.length) throw new Error("Vukova no devolvió controles de socios configurados.");
    const books = {};
    const errors = [];
    sources.forEach(function(source) {
      try {
        const book = books[source.spreadsheetId] || (books[source.spreadsheetId] = SpreadsheetApp.openById(source.spreadsheetId));
        const sheet = book.getSheets().find(function(s) { return s.getSheetId() === source.sheetId; });
        if (!sheet) throw new Error("No se encuentra la pestaña configurada.");
        const lastRow = sheet.getLastRow();
        if (lastRow < 6 || lastRow > 3004 || sheet.getMaxColumns() < source.columns) throw new Error("Revisá el tamaño o las columnas de la planilla.");
        const rows = sheet.getRange(5,1,lastRow-4,source.columns).getDisplayValues();
        const payload = {kind:"members",spreadsheetId:source.spreadsheetId,sheetId:source.sheetId,sheetName:sheet.getName(),service:source.service,rows:rows};
        const response = UrlFetchApp.fetch(url + "/api/imports/sheets", {method:"post",contentType:"application/json",headers:{Authorization:"Bearer " + key},payload:JSON.stringify(payload),muteHttpExceptions:true});
        if (response.getResponseCode() !== 200) throw new Error(response.getContentText());
        const result = JSON.parse(response.getContentText());
        console.log(source.label + ": " + result.records + " fichas; " + (result.warnings.pendingReview || 0) + " por revisar.");
      } catch (error) { errors.push(source.label + ": " + error.message); }
    });
    if (errors.length) throw new Error(errors.join("\\n"));
  } finally { lock.releaseLock(); }
}
`;
}

export function sheetsScript(origin: string, token: string | null) {
  return `// Sincronización de presentes: Acassuso, Victoria, Delta, Olivos y Vilo.
// Pegá el código en el mismo proyecto de Vukova — Presentes y ejecutá instalarVukova.
const VUKOVA_URL = ${JSON.stringify(origin)};
const VUKOVA_CLAVE = ${JSON.stringify(token ?? "")};

function instalarVukova() {
  const props = PropertiesService.getScriptProperties();
  const key = VUKOVA_CLAVE || props.getProperty("VUKOVA_CLAVE");
  if (!key) throw new Error("Usá el proyecto de presentes ya instalado o prepará una conexión nueva desde Vukova.");
  props.setProperties({VUKOVA_URL:VUKOVA_URL,VUKOVA_CLAVE:key});
  ScriptApp.getProjectTriggers().filter(function(t) { return t.getHandlerFunction() === "sincronizarVukova"; }).forEach(function(t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("sincronizarVukova").timeBased().everyHours(1).create();
  sincronizarHistoricoVukova();
  console.log("Histórico sincronizado. Los meses actual y anterior se actualizan cada hora.");
}

function sincronizarHistoricoVukova() { importarPresentesVukova(true); }
function sincronizarVukova() { importarPresentesVukova(false); }

function importarPresentesVukova(historico) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const url = props.getProperty("VUKOVA_URL"), key = props.getProperty("VUKOVA_CLAVE");
    if (!url || !key) throw new Error("Primero ejecutá instalarVukova.");
    const config = UrlFetchApp.fetch(url + "/api/imports/sheets?kind=attendance", {method:"get",headers:{Authorization:"Bearer " + key},muteHttpExceptions:true});
    if (config.getResponseCode() !== 200) throw new Error("No se pudieron consultar las sedes: " + config.getContentText());
    const sources = JSON.parse(config.getContentText()).sources;
    if (!Array.isArray(sources) || !sources.length) throw new Error("No hay planillas de presentes configuradas.");
    const current = Utilities.formatDate(new Date(), "America/Argentina/Buenos_Aires", "yyyy-MM");
    const previousDate = new Date(current + "-15T12:00:00Z");
    previousDate.setUTCMonth(previousDate.getUTCMonth() - 1);
    const previous = Utilities.formatDate(previousDate, "UTC", "yyyy-MM");
    const months = {ENE:1,FEB:2,MAR:3,ABR:4,MAY:5,JUN:6,JUL:7,AGO:8,SEP:9,SET:9,OCT:10,NOV:11,DIC:12};
    const errors = [];
    sources.forEach(function(source) {
      try {
        const book = SpreadsheetApp.openById(source.spreadsheetId);
        const tabs = [];
        book.getSheets().forEach(function(sheet) {
          const title = sheet.getName().trim().normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").replace(/[´'’]+$/, "").toUpperCase();
          const match = title.match(/^(?:PT\\s+)?([A-Z]+)\\s*(\\d{2}|\\d{4})?$/);
          if (!match || source.branchId === "branch-acassuso" && !/^PT\\s+/.test(title)) return;
          const month = months[match[1].slice(0,3)];
          const year = match[2] ? Number(match[2]) + (match[2].length === 2 ? 2000 : 0) : source.year;
          if (!month || year !== source.year) return;
          const period = year + "-" + String(month).padStart(2,"0");
          tabs.push({sheet:sheet,month:month,year:year,period:period});
        });
        if (source.year === Number(current.slice(0,4)) && !tabs.some(function(t) {return t.period===current;}))
          console.warn(source.branchName + ": falta la pestaña de " + current + ". Se conserva el histórico; no se inventan presentes del mes actual.");
        const duplicatePeriods = tabs.map(function(t) {return t.period;}).filter(function(p,i,all) {return all.indexOf(p)!==i;});
        Array.from(new Set(duplicatePeriods)).forEach(function(p) {errors.push(source.branchName + " " + p + ": hay más de una pestaña para este mes. No se actualizó ese período.");});
        tabs.forEach(function(tab) {
          const sheet=tab.sheet, period=tab.period, year=tab.year, month=tab.month;
          if (duplicatePeriods.indexOf(period)!==-1) return;
          if (period > current || !historico && period !== current && period !== previous) return;
          try {
          if (sheet.getLastRow() < 4 || sheet.getLastRow() > 3000 || sheet.getLastColumn() > 100) throw new Error("Revisá las dimensiones de " + sheet.getName());
          const rows = sheet.getRange(1,1,sheet.getLastRow(),sheet.getLastColumn()).getDisplayValues();
          // Las notas de ausencias, teléfonos y comentarios nunca se envían.
          for (let r=3;r<rows.length;r++) {
            if (source.dayStart===3) rows[r][2]="";
            for (let c=source.dayStart;c<rows[r].length;c++)
              if (!/^(?:[1-9]\\d*|p)$/i.test(String(rows[r][c]).trim())) rows[r][c]="";
          }
          const payload = {kind:"attendance",spreadsheetId:source.spreadsheetId,branchId:source.branchId,sheetId:sheet.getSheetId(),sheetName:sheet.getName(),year:year,month:month,rows:rows};
          const response = UrlFetchApp.fetch(url + "/api/imports/sheets", {method:"post",contentType:"application/json",headers:{Authorization:"Bearer " + key},payload:JSON.stringify(payload),muteHttpExceptions:true});
          if (response.getResponseCode() !== 200) throw new Error(period + ": " + response.getContentText());
          const result=JSON.parse(response.getContentText());
          console.log(source.branchName + " " + period + ": " + result.records + " presentes.");
          if (result.warnings && result.warnings.invalidDays && result.warnings.invalidDays.length)
            console.warn(source.branchName + " " + period + ": " + result.warnings.invalidDays.length + " marcas en días inexistentes excluidas. Revisalas en Asistencias de Vukova.");
          } catch (error) { errors.push(source.branchName + " " + period + ": " + error.message); }
        });
      } catch (error) { errors.push(source.branchName + ": " + error.message); }
    });
    if (errors.length) throw new Error(errors.join("\\n"));
  } finally { lock.releaseLock(); }
}
`;
}
