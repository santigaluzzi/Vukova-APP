import assert from "node:assert/strict";
import vm from "node:vm";
import {membersScript} from "../lib/sheets-script.ts";

// Exercise the actual generated Google script with read-only Sheets stubs.
const properties={VUKOVA_SOCIOS_URL:"https://vukova.test",VUKOVA_SOCIOS_CLAVE:"existing-private-key"};
let sources=[{spreadsheetId:"workbook-one",sheetId:1,service:"gym",columns:63,label:"Sede uno"}];
let posts=[];let opened=[];let released=0;let failSource=null;let configStatus=200;
let triggers=[{getHandlerFunction:()=>"sincronizarSociosVukova"},{getHandlerFunction:()=>"sincronizarVukova"}];
const context={
  console:{log:()=>{}},
  PropertiesService:{getScriptProperties:()=>({getProperty:key=>properties[key],setProperties:values=>Object.assign(properties,values)})},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>released++})},
  ScriptApp:{getProjectTriggers:()=>triggers,deleteTrigger:trigger=>{triggers=triggers.filter(t=>t!==trigger);},newTrigger:handler=>({timeBased:()=>({everyHours:hours=>({create:()=>{assert.equal(hours,1);triggers.push({getHandlerFunction:()=>handler});}})})})},
  SpreadsheetApp:{openById:id=>{
    opened.push(id);if(id===failSource)throw new Error("No se puede leer este control");
    return {getSheets:()=>sources.filter(s=>s.spreadsheetId===id).map(s=>({getSheetId:()=>s.sheetId,getName:()=>s.label,getLastRow:()=>8,getMaxColumns:()=>s.columns,getRange:(row,col,count,width)=>{assert.equal(row,5);assert.equal(col,1);assert.equal(count,4);assert.equal(width,s.columns);return {getDisplayValues:()=>[["ALUMNOS"],["SOCIO PRUEBA"]]};}}))};
  }},
  UrlFetchApp:{fetch:(url,options)=>{
    assert.equal(url,"https://vukova.test/api/imports/sheets");
    assert.equal(options.headers.Authorization,"Bearer existing-private-key");
    if(options.method==="get")return {getResponseCode:()=>configStatus,getContentText:()=>JSON.stringify({sources})};
    assert.equal(options.method,"post");const body=JSON.parse(options.payload);assert.equal(body.kind,"members");posts.push(body);
    return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({records:1,warnings:{pendingReview:0}})};
  }},
};
vm.createContext(context);
vm.runInContext(membersScript("https://vukova.test",null),context);
context.instalarSociosVukova();
assert.equal(properties.VUKOVA_SOCIOS_CLAVE,"existing-private-key");
assert.equal(posts.length,1);assert.equal(released,1);
assert.equal(triggers.filter(t=>t.getHandlerFunction()==="sincronizarSociosVukova").length,1);
assert.equal(triggers.filter(t=>t.getHandlerFunction()==="sincronizarVukova").length,1,"Do not remove the attendance trigger.");

sources.push({spreadsheetId:"workbook-two",sheetId:2,service:"gym",columns:65,label:"Sede dos"});
posts=[];context.sincronizarSociosVukova();
assert.deepEqual(posts.map(p=>p.sheetId),[1,2],"New configured sources appear on the next run without changing the installed code.");
failSource="workbook-one";posts=[];
assert.throws(()=>context.sincronizarSociosVukova(),/Sede uno/);
assert.deepEqual(posts.map(p=>p.sheetId),[2],"A denied source does not stop syncing the other branches.");
const releasedBefore=released;opened=[];configStatus=401;
assert.throws(()=>context.sincronizarSociosVukova(),/No se pudieron consultar/);
assert.equal(opened.length,0);assert.equal(released,releasedBefore+1);
delete properties.VUKOVA_SOCIOS_CLAVE;
assert.throws(()=>context.instalarSociosVukova(),/mismo proyecto/);
console.log("PASS: installed member script preserves credentials and attendance triggers, reads current source configuration, continues other sources on failure and releases its lock.");
