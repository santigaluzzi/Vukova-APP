import assert from 'node:assert/strict';
import vm from 'node:vm';
import {sheetsScript} from '../lib/sheets-script.ts';
import {parseAttendance} from '../lib/sheet-data.ts';

const sources=[
  {spreadsheetId:'victoria',branchId:'branch-victoria',branchName:'Victoria',year:2026,dayStart:3},
  {spreadsheetId:'vilo',branchId:'branch-vilo',branchName:'Vilo',year:2026,dayStart:2},
];
const sheet=(name,id,rows)=>({getName:()=>name,getSheetId:()=>id,getLastRow:()=>rows.length,getLastColumn:()=>Math.max(...rows.map(r=>r.length)),getRange:()=>({getDisplayValues:()=>rows.map(r=>r.map(v=>String(v??'')))})});
const victoria=sheet('SEPTIEMBRE 26',1,[[],[],['ALUMNOS','ASISTENCIAS MENSUALES','CONTACTO',1],['SOCIO VICTORIA','','privado','P']]);
const june=sheet('JUNIO 26',2,[[],[],['DIAS','',1,30,31],['SOCIO VILO','999',1,1,1]]);
const october=sheet('OCTUBRE 26',3,[[],[],['DIAS','',1],['SOCIO VILO','999',1]]);
const april=sheet('ABRIL 26',4,[[],[],['DIAS','',1],['SOCIO VILO','999',1]]);
class FixedDate extends Date {constructor(...args){super(...(args.length?args:['2026-10-01T12:00:00Z']));}}
function run({historical=true,duplicate=false,failJune=false}={}) {
  const posts=[],warnings=[];
  const response=(status,data)=>({getResponseCode:()=>status,getContentText:()=>JSON.stringify(data)});
  const context={Date:FixedDate,PropertiesService:{getScriptProperties:()=>({getProperty:key=>key==='VUKOVA_URL'?'https://vukova.test':'fixture-key'})},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},Utilities:{formatDate:date=>date.toISOString().slice(0,7)},console:{log:()=>{},warn:message=>warnings.push(message)},SpreadsheetApp:{openById:id=>({getSheets:()=>id==='victoria'?[victoria]:[june,october,april,...(duplicate?[sheet('OCTUBRE 2026',5,[[],[],['DIAS','',1],['OTRO SOCIO','',1]])]:[])]})},UrlFetchApp:{fetch:(url,options)=>{
    if(options.method==='get')return response(200,{sources});
    const payload=JSON.parse(options.payload);posts.push(payload);
    if(failJune&&payload.month===6)return response(500,{error:'Fallo simulado'});
    const parsed=parseAttendance(payload.rows,2026,payload.month,'2026-10-01',sources.find(s=>s.spreadsheetId===payload.spreadsheetId).dayStart);
    return response(200,{records:parsed.entries.length,warnings:parsed.warnings});
  }}};
  let error;
  try {vm.runInNewContext(sheetsScript('https://vukova.test',null)+`\nimportarPresentesVukova(${historical});`,context);}catch(e){error=e;}
  return {posts,warnings,error};
}
const historical=run();assert.equal(historical.error,undefined);
assert.equal(historical.posts.length,4);
assert.ok(historical.warnings.some(w=>w.includes('Victoria: falta la pestaña de 2026-10')));
assert.ok(historical.warnings.some(w=>w.includes('marcas en días inexistentes')));
assert.equal(historical.posts[0].rows[3][2],'','Contact information is removed before delivery.');
const recurring=run({historical:false});assert.equal(recurring.error,undefined);
assert.deepEqual(recurring.posts.map(p=>p.sheetName),['SEPTIEMBRE 26','OCTUBRE 26']);
const duplicated=run({duplicate:true});assert.match(duplicated.error.message,/más de una pestaña/);
assert.equal(duplicated.posts.some(p=>p.month===10),false,'Do not replace a month from either ambiguous tab.');
const failed=run({failJune:true});assert.match(failed.error.message,/Fallo simulado/);
assert.ok(failed.posts.some(p=>p.month===4),'A failed month must not stop later valid tabs.');
assert.ok(failed.posts.some(p=>p.month===10));
console.log('PASS: missing current tab is reported without blocking imports; invalid-date warnings, duplicate-tab safety, isolated month failures, daily refresh and sanitized delivery.');
