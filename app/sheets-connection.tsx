"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card,CardHeader,CardTitle,CardDescription,CardContent } from "@/components/ui/card";

type Connection = {createdAt:string;lastUsedAt:string|null}|null;
type Receipt = {id:string;branchId?:string;kind:string;sheetName:string;records:number;syncedAt:string;review:{pendingReview?:number;ambiguous?:{name:string;sourceRow:number}[]}};
type Connections = {connection:Connection;membersConnection:Connection;imports:Receipt[];sources:{id:string;branchName:string}[];attendanceSources:{branchId:string;branchName:string}[]};
function timestamp(value:string) { return new Intl.DateTimeFormat("es-AR",{dateStyle:"short",timeStyle:"short",timeZone:"America/Argentina/Buenos_Aires"}).format(new Date(value)); }

export function SheetsConnection() {
  const [data,setData] = React.useState<Connections|null>(null);
  const [error,setError] = React.useState("");
  const refresh = React.useCallback(async () => {
    setError("");
    try { const response=await fetch("/api/settings/sheets");const payload=await response.json() as Connections & {error?:string};if(!response.ok)throw new Error(payload.error);setData(payload); }
    catch(error) {setError(error instanceof Error?error.message:"No se pudo comprobar la conexión.");}
  },[]);
  React.useEffect(()=>{void refresh();},[refresh]);
  if(error) return <p role="alert" className="mb-6 text-sm text-red-700">{error}<Button variant="outline" className="ml-3" onClick={refresh}>Reintentar</Button></p>;
  if(!data) return <p role="status" className="mb-6 text-sm">Cargando conexiones…</p>;
  return <div className="space-y-6 pb-6">
    <ConnectionCard scope="members" connection={data.membersConnection} imports={data.imports.filter(i=>i.kind==="members")} sources={data.sources} refresh={refresh}/>
    <ConnectionCard scope="attendance" connection={data.connection} imports={data.imports.filter(i=>i.kind==="attendance")} sources={data.attendanceSources} refresh={refresh}/>
  </div>;
}

function ConnectionCard({scope,connection,imports,sources,refresh}:{scope:"members"|"attendance";connection:Connection;imports:Receipt[];sources:{id?:string;branchId?:string;branchName:string}[];refresh:()=>Promise<void>}) {
  const members=scope==="members";
  const [script,setScript]=React.useState("");const [busy,setBusy]=React.useState(false);const [error,setError]=React.useState("");const [copied,setCopied]=React.useState(false);
  const [reusesExisting,setReusesExisting]=React.useState(false);
  const canReuse=!!connection?.lastUsedAt;
  const installExisting=script?reusesExisting:canReuse;
  const branchNames=new Intl.ListFormat("es",{style:"long",type:"conjunction"}).format([...new Set(sources.map(s=>s.branchName))]);
  const prepareLabel=members?(canReuse?"Actualizar código de socios":"Preparar sincronización de socios"):(canReuse?"Actualizar código de presentes":"Preparar conexión de presentes");
  const handler=members?"instalarSociosVukova":"instalarVukova";
  async function generate(reuse=canReuse) {
    setBusy(true);setError("");
    try {const response=await fetch("/api/settings/sheets",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({scope,reuse})});const payload=await response.json() as {script:string;error?:string;reusesConnection?:boolean};if(!response.ok)throw new Error(payload.error);setScript(payload.script);setReusesExisting(!!payload.reusesConnection);setCopied(false);await refresh();}
    catch(error){setError(error instanceof Error?error.message:"No se pudo preparar la conexión.");}finally{setBusy(false);}
  }
  async function copy(){try{await navigator.clipboard.writeText(script);setCopied(true);}catch{setError("Seleccioná todo el código del cuadro y copialo manualmente.");}}
  return <Card className="border-[#dce4eb] shadow-none">
    <CardHeader><CardTitle>{members?`Socios · ${branchNames}`:`Presentes · ${branchNames}`}</CardTitle><CardDescription>{members?"Actualiza cada hora las fichas y el historial desde los controles de socios de estas sedes.":"Carga el histórico al instalar y actualiza el mes actual y el anterior cada hora, incluyendo correcciones."}</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      <div className="rounded-lg bg-[#f5f7fa] p-3 text-sm text-[#516476]">{connection?.lastUsedAt ? <>Últimos datos recibidos por esta conexión: <strong>{timestamp(connection.lastUsedAt)}</strong>.</>:<>Actualización automática <strong>pendiente de activar en Google</strong>. Las fichas y asistencias ya importadas se pueden consultar.</>}</div>
      <ol className="list-decimal space-y-2 pl-5 text-sm text-[#516476]">
        <li>Presioná <strong>{prepareLabel}</strong> y copiá el código completo.</li>
        <li>Abrí <a href="https://script.google.com" target="_blank" rel="noreferrer" className="underline">Google Apps Script</a> con la cuenta que tiene acceso a {members?"los controles de socios de todas las sedes indicadas":"las planillas de presentes de todas las sedes indicadas"}. {installExisting?<>Entrá al <strong>mismo proyecto de {members?"socios":"presentes"} que ya está instalado</strong>.</>:<>Creá un <strong>proyecto nuevo</strong>{members?" llamado Vukova — Socios":" llamado Vukova — Presentes"}.</>}</li>
        <li>Borrá el contenido de <strong>Código.gs</strong>, pegá el código copiado y guardá.</li>
        <li>En el selector de funciones, elegí <strong>{handler}</strong> y presioná <strong>Ejecutar</strong>. Autorizá el acceso que solicita Google.</li>
        <li>Esperá a que termine y volvé acá a <strong>Comprobar conexión</strong>. La primera actualización es inmediata; luego se repite cada hora.</li>
      </ol>
      {members?<p className="text-sm text-[#516476]">El proyecto de socios es independiente del de presentes. Actualiza nombres, estados, planes e historial. Si una ficha desaparece o hay nombres repetidos que no pueden distinguirse, se conserva para revisión. La conexión lee las planillas sin modificarlas.</p>:<p className="text-sm text-[#516476]">Se leen las planillas originales sin modificarlas. Al instalar se importan los meses anteriores de 2026; luego se actualizan el mes actual y el anterior cada hora.</p>}
      <p className="text-xs text-[#718294]">{installExisting?"Actualizar el código conserva la clave y reutiliza el proyecto instalado. Las sedes incorporadas a Vukova se consultan en cada ejecución.":"Guardá el código en un proyecto privado. Preparar una conexión nueva reemplaza su clave anterior; después hay que instalar el código."}</p>
      <div className="flex flex-wrap gap-3"><Button disabled={busy} onClick={()=>generate()}>{busy?"Preparando…":prepareLabel}</Button><Button variant="outline" onClick={refresh}>Comprobar conexión</Button></div>
      {canReuse&&<details><summary className="cursor-pointer text-xs text-[#718294]">¿Perdiste el proyecto de {members?"socios":"presentes"} anterior?</summary><p className="my-2 text-xs text-[#718294]">Podés crear una conexión nueva. Esto invalida la clave del proyecto anterior.</p><Button variant="outline" disabled={busy} onClick={()=>generate(false)}>Crear conexión nueva</Button></details>}
      {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
      {script&&<><Button variant="outline" onClick={copy}>{copied&&<Check className="size-4"/>}{copied?"Código copiado":"Copiar código completo"}</Button><textarea readOnly aria-label={`Código de ${members?"socios":"presentes"} para Google Apps Script`} className="h-52 w-full rounded-lg border p-3 font-mono text-xs" value={script}/><p className="text-xs text-[#718294]">Copialo antes de salir de esta página.</p></>}
      <details><summary className="cursor-pointer text-sm text-[#516476]">Ver actualizaciones ({imports.length})</summary><ul className="mt-3 space-y-3 text-xs text-[#718294]">{imports.map(i=><li key={i.id}><p>{sources.find(s=>s.id===i.id||s.branchId===i.branchId)?.branchName} · {i.sheetName} · {i.records} registros · {timestamp(i.syncedAt)}</p>{!!i.review.pendingReview&&<p className="mt-1 text-amber-800">{i.review.pendingReview} fichas por revisar en Socios.</p>}{i.review.ambiguous?.map(r=><p key={`${r.name}-${r.sourceRow}`} className="mt-1 text-amber-800">Fila {r.sourceRow}: {r.name}. Nombre repetido: revisar identidad para poder actualizar.</p>)}</li>)}</ul></details>
    </CardContent>
  </Card>;
}
