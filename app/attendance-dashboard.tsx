"use client";

import * as React from "react";
import { AlertCircle, ArrowUpRight, Clock3, RefreshCw, Search, UserCheck } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer } from "@/components/ui/chart";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { attendanceRanges, rankAttendance, type AnalyticsPerson, type AttendanceAnalytics, type AttendancePeriod, type Frequency } from "@/lib/attendance-analytics";
import { defaultBranches } from "@/lib/branch-catalog";

type AttendanceData = { periods: AttendancePeriod[]; viewBranch:string; selected: {period:string;syncedAt:string;manualToday?:number;warnings:{unassigned:{sourceRow:number;date:string;marker:string;branchId:string}[];invalidDays?:{sourceRow:number;name:string;day:number;marker:string;branchId:string}[]};sources:{branchId:string;spreadsheetId:string;sheetName:string}[]} | null; analytics?: AttendanceAnalytics };
type MemberChoice = {id:string;name:string;service:string};
const selectClass="h-10 w-full rounded-lg border border-[#dce4eb] bg-white px-3 text-sm text-[#34495c] focus-visible:outline-2 focus-visible:outline-[#8fac63]";
const number=(n:number,maximumFractionDigits=0)=>new Intl.NumberFormat("es-AR",{maximumFractionDigits}).format(n);
const date=(day:string,options:Intl.DateTimeFormatOptions={day:"numeric",month:"short"})=>new Intl.DateTimeFormat("es-AR",{...options,timeZone:"UTC"}).format(new Date(`${day}T12:00:00Z`));
const month=(period:string)=>date(`${period}-01`,{month:"long",year:"numeric"});
const timestamp=(value:string)=>new Intl.DateTimeFormat("es-AR",{dateStyle:"short",timeStyle:"short",timeZone:"America/Argentina/Buenos_Aires"}).format(new Date(value));
const normalize=(value:string)=>value.normalize("NFD").replace(/\p{Diacritic}/gu,"").toLocaleLowerCase("es");
const frequencies: {value:Frequency;label:string}[]=[
  {value:"all",label:"Todas las frecuencias"},{value:"zero",label:"0 · Sin asistencias"},{value:"under-one",label:"Más de 0 y menos de 1 / semana"},
  {value:"one",label:"1 a menos de 2 / semana"},{value:"two",label:"2 a menos de 3 / semana"},{value:"three-plus",label:"3 o más / semana"},
];

export function ImportedAttendance({ branchFilter = "all" }: { branchFilter?: string }) {
  const [period,setPeriod]=React.useState("");const [revision,setRevision]=React.useState(0);
  const [checkInOpen,setCheckInOpen]=React.useState(false);
  const [data,setData]=React.useState<AttendanceData|null>(null);const [loading,setLoading]=React.useState(true);const [error,setError]=React.useState("");
  React.useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError("");
    fetch(`/api/attendance/sheets?analytics=1&branch=${encodeURIComponent(branchFilter)}${period?`&period=${encodeURIComponent(period)}`:""}`,{signal:controller.signal})
      .then(async response=>{const body=await response.json() as AttendanceData & {error?:string};if(!response.ok)throw new Error(body.error || "No se pudieron cargar las asistencias.");return body as AttendanceData;})
      .then(setData).catch(e=>{if(e.name!=="AbortError")setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[period,revision,branchFilter]);
  const branchName=branchFilter==="all"?"Todas las sedes":defaultBranches.find(branch=>branch.id===branchFilter)?.name.replace("Vukova ","")??"Sede";
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-sm font-medium text-[#718294]">{branchName} · Gimnasio</p><h2 className="mt-1 text-2xl font-bold tracking-tight">Actividad y asistencia</h2></div>
      <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
        {branchFilter!=="all"&&<Button className="h-10 bg-[#102033] text-white hover:bg-[#1d3752]" onClick={()=>setCheckInOpen(true)}><UserCheck className="size-4"/>Registrar asistencia</Button>}
        <label className="min-w-48 flex-1 text-sm font-medium">Mes<select aria-label="Mes de asistencia" className={`${selectClass} mt-1 capitalize`} value={data?.selected?.period ?? ""} disabled={!data?.periods.length} onChange={e=>setPeriod(e.target.value)}>{data?.periods.map(p=><option key={p.period} value={p.period}>{month(p.period)}</option>)}</select></label>
        <Button variant="outline" className="h-10" disabled={loading} onClick={()=>setRevision(r=>r+1)}><RefreshCw className={`size-4 ${loading?"animate-spin":""}`}/>Actualizar</Button>
      </div>
    </div>
    {loading && <div className="rounded-xl border bg-white p-8 text-sm text-[#516476]" role="status">Cargando estadísticas de asistencia…</div>}
    {!loading && error && <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900" role="alert">{error}<Button className="ml-3" variant="outline" onClick={()=>setRevision(r=>r+1)}>Reintentar</Button></div>}
    {!loading && !error && (!data?.selected || !data.analytics) && <Card><CardContent className="py-8"><p>Todavía no hay asistencias importadas para {branchName}.</p></CardContent></Card>}
    {!loading && !error && data?.selected && data.analytics && <AttendanceContent key={data.selected.period} data={data} analytics={data.analytics} refresh={()=>setRevision(r=>r+1)}/>}
    {branchFilter==="all"&&<p className="text-sm text-[#516476]">Seleccioná una sede para registrar una asistencia manual.</p>}
    <ManualCheckIn open={checkInOpen} branchId={branchFilter} close={()=>setCheckInOpen(false)} onSaved={()=>setRevision(r=>r+1)}/>
  </div>;
}

type CheckInMember={id:string;name:string;homeBranchId:string;status:string};
function ManualCheckIn({open,branchId,close,onSaved}:{open:boolean;branchId:string;close:()=>void;onSaved:()=>void}) {
  const [query,setQuery]=React.useState("");const [members,setMembers]=React.useState<CheckInMember[]>([]);
  const [selected,setSelected]=React.useState<CheckInMember|null>(null);
  const [loading,setLoading]=React.useState(false);const [saving,setSaving]=React.useState(false);
  const [error,setError]=React.useState("");const [notice,setNotice]=React.useState("");
  React.useEffect(()=>{if(!open){setQuery("");setMembers([]);setSelected(null);setError("");setNotice("");}},[open]);
  React.useEffect(()=>{
    if(!open||query.trim().length<2){setMembers([]);return;}
    const controller=new AbortController();const timeout=setTimeout(()=>{
      setLoading(true);setError("");
      fetch(`/api/attendance/manual?branch=${encodeURIComponent(branchId)}&q=${encodeURIComponent(query.trim())}`,{signal:controller.signal})
        .then(async response=>{const body=await response.json() as {members?:CheckInMember[];error?:string};if(!response.ok)throw new Error(body.error??"No se pudieron buscar socios.");setMembers(body.members??[]);})
        .catch(e=>{if(e.name!=="AbortError")setError(e.message);})
        .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    },250);
    return()=>{clearTimeout(timeout);controller.abort();};
  },[open,branchId,query]);
  async function save(){
    if(!selected)return;
    setSaving(true);setError("");setNotice("");
    try{
      const response=await fetch("/api/attendance/manual",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({branchId,memberId:selected.id})});
      const result=await response.json() as {error?:string;alreadyPresent?:boolean;source?:string;name?:string};
      if(!response.ok)throw new Error(result.error??"No se pudo registrar.");
      setNotice(result.alreadyPresent?`${result.name} ya figura hoy en ${result.source==="sheet"?"la planilla":"la app"}.`:`Asistencia registrada para ${result.name}.`);
      setSelected(null);setQuery("");setMembers([]);onSaved();
    }catch(e){setError(e instanceof Error?e.message:"No se pudo registrar.");}
    finally{setSaving(false);}
  }
  return <Dialog open={open} onOpenChange={value=>{if(!value)close();}}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>Registrar asistencia de hoy</DialogTitle><DialogDescription>{defaultBranches.find(b=>b.id===branchId)?.name} · Buscá al socio, aunque pertenezca a otra sede.</DialogDescription></DialogHeader>
    <label className="block text-sm font-medium">Socio<Input autoFocus className="mt-2" value={query} onChange={e=>{setQuery(e.target.value);setSelected(null);setNotice("");}} placeholder="Nombre o apellido" aria-label="Buscar socio para registrar asistencia"/></label>
    {query.trim().length<2&&<p className="text-sm text-[#516476]">Escribí al menos dos letras.</p>}
    {loading&&<p className="text-sm text-[#516476]" role="status">Buscando…</p>}
    {!loading&&query.trim().length>=2&&members.length===0&&!error&&<p className="text-sm text-[#516476]">No se encontró un socio de gimnasio con ese nombre.</p>}
    {members.length>0&&<div className="max-h-64 space-y-1 overflow-y-auto" role="listbox" aria-label="Resultados de socios">{members.map(m=><button key={m.id} type="button" role="option" aria-selected={selected?.id===m.id} className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${selected?.id===m.id?"border-[#8aa944] bg-[#f3f8e7]":"border-[#dce4eb] hover:bg-[#f4f7f9]"}`} onClick={()=>setSelected(m)}><span className="block font-semibold">{m.name}</span><span className="text-[#516476]">{defaultBranches.find(b=>b.id===m.homeBranchId)?.name??"Sede sin identificar"} · {m.status==="active"?"Activo":m.status==="renewal"?"Renovación":m.status==="inactive"?"Inactivo":m.status}</span></button>)}</div>}
    {selected&&selected.status!=="active"&&<p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">La ficha figura como {selected.status==="renewal"?"renovación":"inactiva o pendiente"}. Confirmá su ingreso con recepción antes de registrarlo.</p>}
    {notice&&<p className="rounded-lg bg-[#f3f8e7] p-3 text-sm text-[#365313]" role="status">{notice}</p>}
    {error&&<p className="text-sm text-red-700" role="alert">{error}</p>}
    <Button onClick={save} disabled={!selected||saving} className="bg-[#102033] text-white hover:bg-[#1d3752]">{saving?"Registrando…":"Confirmar asistencia"}</Button>
  </DialogContent></Dialog>;
}

function Metric({label,value,detail,primary=false}:{label:string;value:string;detail:string;primary?:boolean}) {
  return <Card className={primary?"gap-2 border-[#102033] bg-[#102033] py-5 text-white shadow-none":"gap-2 border-[#dce4eb] py-5 shadow-none"}><CardContent><p className={`text-sm ${primary?"text-[#d3e0e9]":"text-[#516476]"}`}>{label}</p><p className={`mt-2 text-3xl font-bold tabular-nums ${primary?"text-[#c1ea76]":"text-[#15273a]"}`}>{value}</p><p className={`mt-2 text-xs leading-5 ${primary?"text-[#d3e0e9]":"text-[#718294]"}`}>{detail}</p></CardContent></Card>;
}

type ChartDatum={label:string;value:number;detail:string;partial?:boolean};
function AttendanceChart({data,average,label,decimal=false}:{data:ChartDatum[];average?:number|null;label:string;decimal?:boolean}) {
  if(!data.length)return <p className="py-12 text-center text-sm text-[#718294]">No hay datos para este período.</p>;
  return <><ChartContainer config={{value:{label,color:"#24556a"}}} className="h-[260px] w-full aspect-auto sm:h-[290px]" aria-label={label}>
    <BarChart accessibilityLayer data={data} margin={{top:18,right:12,left:-12,bottom:0}}>
      <CartesianGrid vertical={false} strokeDasharray="3 4"/>
      <XAxis dataKey="label" axisLine={false} tickLine={false} tickMargin={10} minTickGap={8}/>
      <YAxis axisLine={false} tickLine={false} allowDecimals={decimal} tickFormatter={v=>number(Number(v),decimal?1:0)}/>
      <Tooltip cursor={{fill:"#edf2f5"}} formatter={value=>[number(Number(value),decimal?2:0),label]} labelFormatter={(value,payload)=>String(payload[0]?.payload?.detail ?? value)} contentStyle={{borderRadius:10,borderColor:"#dce4eb",fontSize:14}}/>
      {average!=null && average>0 && <ReferenceLine y={average} stroke="#7a922d" strokeDasharray="5 4" label={{value:"Promedio",position:"insideTopRight",fontSize:12,fill:"#52651f"}}/>}
      <Bar dataKey="value" fill="#24556a" radius={[4,4,0,0]} isAnimationActive={false} maxBarSize={52}>{data.map((d,i)=><Cell key={`${d.label}-${i}`} fill={d.partial?"#8aa944":"#24556a"}/>)}</Bar>
    </BarChart>
  </ChartContainer><table className="sr-only"><caption>{label}</caption><thead><tr><th>Período</th><th>Asistencias</th></tr></thead><tbody>{data.map((d,i)=><tr key={i}><td>{d.detail}</td><td>{number(d.value,decimal?2:0)}</td></tr>)}</tbody></table></>;
}

export function AttendanceContent({data,analytics:a,refresh}:{data:AttendanceData;analytics:AttendanceAnalytics;refresh:()=>void}) {
  const [query,setQuery]=React.useState("");const [frequency,setFrequency]=React.useState<Frequency>("all");
  const [rangeKind,setRangeKind]=React.useState<"month"|"fortnight"|"week">("month");const [rangeId,setRangeId]=React.useState("");
  const [sort,setSort]=React.useState<"most"|"least"|"name">("most");const [onlyReview,setOnlyReview]=React.useState(false);const [page,setPage]=React.useState(0);
  const [detail,setDetail]=React.useState<AnalyticsPerson|null>(null);
  const ranges=attendanceRanges(a.period,a.through,rangeKind);const range=ranges.find(r=>r.id===rangeId) ?? ranges[ranges.length-1];
  const ranked=range?rankAttendance(a.people,range,{query,frequency,sort,onlyReview}):[];
  const pages=Math.max(1,Math.ceil(ranked.length/30));const currentPage=Math.min(page,pages-1);
  React.useEffect(()=>setPage(0),[query,frequency,rangeKind,rangeId,sort,onlyReview]);
  const peak=[...a.daily].sort((x,y)=>y.total-x.total)[0];
  const unassigned=data.selected?.warnings.unassigned ?? [];
  const invalidDays=data.selected?.warnings.invalidDays ?? [];
  const periodDetail=`Del 1 al ${Number(a.through.slice(-2))} de ${date(`${a.period}-01`,{month:"long"})}`;
  return <>
    {invalidDays.length>0&&<div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p className="font-semibold">{invalidDays.length} marcas en días que no existen en este mes</p><p className="mt-1">Se importaron las asistencias válidas. Estas marcas quedan fuera de los totales hasta corregirlas en la planilla:</p><ul className="mt-2 list-disc pl-5">{invalidDays.map(u=><li key={`${u.branchId}-${u.sourceRow}-${u.day}`}>{defaultBranches.find(b=>b.id===u.branchId)?.name??u.branchId} · fila {u.sourceRow} · {u.name||"Sin nombre"} · día {u.day} · marca {u.marker}</li>)}</ul></div>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric primary label="Asistencias del mes" value={number(a.total)} detail={`${periodDetail} · ${number(a.attending)} personas con presentes`}/>
      <Metric label="Promedio diario" value={number(a.averageDaily,1)} detail={`Asistencias por día calendario · ${a.elapsedDays} días`}/>
      <Metric label="Promedio semanal" value={number(a.averageWeekly,1)} detail="Asistencias por cada 7 días del mes observado"/>
      <Metric label="Promedio mensual" value={a.averageMonthly===null?"—":number(a.averageMonthly,1)} detail={a.completedMonths?`${a.completedMonths} meses completos importados de ${a.period.slice(0,4)}, hasta el mes elegido`:"Disponible al contar con un mes completo"}/>
    </div>
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
      <Card className="min-w-0 border-[#dce4eb] shadow-none"><CardHeader><CardTitle>Asistencias en el tiempo</CardTitle><CardDescription>{periodDetail}. Una asistencia por persona y día.</CardDescription></CardHeader><CardContent>
        <Tabs defaultValue="day"><TabsList aria-label="Agrupación del gráfico" className="mb-3"><TabsTrigger value="day">Días</TabsTrigger><TabsTrigger value="week">Semanas</TabsTrigger><TabsTrigger value="month">Meses</TabsTrigger></TabsList>
          <TabsContent value="day"><AttendanceChart label="Asistencias diarias" average={a.averageDaily} data={a.daily.map(d=>({label:String(Number(d.date.slice(-2))),value:d.total,detail:date(d.date,{weekday:"long",day:"numeric",month:"long"})}))}/><p className="mt-3 text-sm text-[#516476]">{peak?.total?`Día con más presentes: ${date(peak.date)} · ${number(peak.total)} asistencias.`:"Todavía no hay presentes confirmados en este mes."}</p></TabsContent>
          <TabsContent value="week"><AttendanceChart label="Asistencias semanales" data={a.weeks.map(w=>({label:`${Number(w.start.slice(-2))}–${Number(w.end.slice(-2))}`,value:w.total,detail:w.label,partial:w.days<7}))}/><p className="mt-3 text-sm text-[#516476]">Semanas de lunes a domingo, recortadas al mes. Las barras verdes corresponden a semanas parciales.</p></TabsContent>
          <TabsContent value="month"><AttendanceChart label="Asistencias mensuales" average={a.averageMonthly} data={a.monthly.map(m=>({label:date(`${m.period}-01`,{month:"short"}),value:m.total,detail:`${month(m.period)}${m.complete?"":` · hasta el ${date(m.through)}`}`,partial:!m.complete}))}/><p className="mt-3 text-sm text-[#516476]">El promedio mensual utiliza meses completos. Las barras verdes muestran meses parciales.</p></TabsContent>
        </Tabs>
      </CardContent></Card>
      <Card className="min-w-0 border-[#dce4eb] shadow-none"><CardHeader><CardTitle>Promedio por día de la semana</CardTitle><CardDescription>Para comparar qué días tienen mayor concurrencia.</CardDescription></CardHeader><CardContent><AttendanceChart decimal label="Promedio de asistencias" data={a.weekdays.filter(d=>d.days).map(d=>({label:d.label.slice(0,3),value:d.average,detail:`${d.label} · ${d.days} días observados`}))}/><p className="mt-3 text-sm text-[#516476]">Incluye días sin presentes dentro del período observado.</p></CardContent></Card>
    </div>
    <div className="flex items-start gap-3 rounded-xl border border-[#dce4eb] bg-white p-4"><Clock3 className="mt-0.5 size-5 shrink-0 text-[#718294]"/><div><p className="font-semibold">Horarios pico y bajos · pendientes de datos</p><p className="mt-1 text-sm text-[#516476]">La planilla registra el día, pero no la hora de ingreso. Necesitamos ese dato para mostrar la concurrencia por horario.</p></div></div>
    <Card className="min-w-0 border-[#dce4eb] shadow-none"><CardHeader>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>Frecuencia por socio</CardTitle><CardDescription className="mt-2">{number(a.zeroExpected)} socios activos o con renovación sin presentes en el mes.</CardDescription></div>{a.reviewCount>0&&<Button variant={onlyReview?"default":"outline"} onClick={()=>setOnlyReview(v=>!v)} aria-pressed={onlyReview}><AlertCircle className="size-4"/>{onlyReview?"Mostrar todos":`Revisar ${a.reviewCount} fichas`}</Button>}</div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(160px,1.2fr)_140px_minmax(150px,1fr)_minmax(190px,1.3fr)_minmax(140px,1fr)]">
        <label className="text-sm font-medium">Socio<div className="relative mt-1"><Search className="absolute left-3 top-3 size-4 text-[#718294]"/><Input value={query} onChange={e=>setQuery(e.target.value)} className="h-10 pl-9" placeholder="Buscar por nombre" aria-label="Buscar socio en asistencias"/></div></label>
        <label className="text-sm font-medium">Período del ranking<select className={`${selectClass} mt-1`} value={rangeKind} onChange={e=>{setRangeKind(e.target.value as typeof rangeKind);setRangeId("");}}><option value="month">Mes</option><option value="fortnight">Quincena</option><option value="week">Semana</option></select></label>
        <label className="text-sm font-medium">Fechas<select className={`${selectClass} mt-1`} value={range?.id ?? ""} onChange={e=>setRangeId(e.target.value)}>{ranges.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
        <label className="text-sm font-medium">Frecuencia semanal del mes<select className={`${selectClass} mt-1`} value={frequency} onChange={e=>setFrequency(e.target.value as Frequency)}>{frequencies.map(f=><option key={f.value} value={f.value}>{f.label}</option>)}</select></label>
        <label className="text-sm font-medium">Ordenar por<select className={`${selectClass} mt-1`} value={sort} onChange={e=>setSort(e.target.value as typeof sort)}><option value="most">Más asistencias</option><option value="least">Menos asistencias</option><option value="name">Nombre A–Z</option></select></label>
      </div>
      <p className="mt-1 text-sm leading-6 text-[#516476]">La frecuencia semanal usa todo el mes observado: presentes × 7 ÷ {a.elapsedDays} días. El ranking cuenta los presentes entre las fechas elegidas.</p>
    </CardHeader><CardContent>
      <Table><TableHeader><TableRow><TableHead className="w-12">#</TableHead><TableHead>Socio</TableHead><TableHead className="text-right">Asistencias<br/><span className="font-normal">del período</span></TableHead><TableHead className="text-right">Promedio<br/><span className="font-normal">por semana del mes</span></TableHead><TableHead className="hidden sm:table-cell">Última asistencia<br/><span className="font-normal">del mes</span></TableHead><TableHead><span className="sr-only">Detalle o revisión</span></TableHead></TableRow></TableHeader><TableBody>
        {ranked.slice(currentPage*30,(currentPage+1)*30).map((p,i)=><TableRow key={p.id}><TableCell className="tabular-nums text-[#718294]">{currentPage*30+i+1}</TableCell><TableCell className="min-w-40 whitespace-normal font-medium">{p.displayName}{(data.viewBranch==="all"||p.otherBranch)&&<span className="mt-1 block text-xs font-normal text-[#516476]">{data.viewBranch==="all" ? (defaultBranches.find(b=>b.id===p.branchId)?.name.replace("Vukova ","")??"Otra sede") : p.memberStatus==="active"?"Activo · Otra sede":"Otra sede"}{data.viewBranch==="all"&&p.otherBranch?" · Socio de otra sede":""}</span>}</TableCell><TableCell className="text-right text-base font-semibold tabular-nums">{p.rangeTotal}</TableCell><TableCell className="text-right tabular-nums">{p.weeklyAverage===null?<span className="text-amber-800">Por revisar</span>:number(p.weeklyAverage,2)}</TableCell><TableCell className="hidden text-[#516476] sm:table-cell">{p.dates.length?date(p.dates[p.dates.length-1]):"Sin presentes"}</TableCell><TableCell className="text-right"><Button size="sm" variant="ghost" className={p.needsReview?"text-amber-800":""} onClick={()=>setDetail(p)}>{p.needsReview?<><AlertCircle className="size-4"/>Revisar</>:"Detalle"}</Button></TableCell></TableRow>)}
      </TableBody></Table>
      {!ranked.length&&<p className="py-10 text-center text-sm text-[#718294]">No hay socios que coincidan con estos filtros.</p>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-[#516476]"><span>{number(ranked.length)} socios · página {currentPage+1} de {pages}{onlyReview?" · Solo por revisar":""}</span><div className="flex gap-2"><Button variant="outline" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>Anterior</Button><Button variant="outline" disabled={currentPage+1>=pages} onClick={()=>setPage(currentPage+1)}>Siguiente</Button></div></div>
    </CardContent></Card>
    {unassigned.length>0&&<div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p className="font-semibold">{unassigned.length} marcas sin nombre para revisar en la planilla</p><p className="mt-1">No se incluyen en los totales: {unassigned.slice(0,8).map(u=>`${defaultBranches.find(b=>b.id===u.branchId)?.name??u.branchId}, fila ${u.sourceRow}, ${date(u.date)} (marca ${u.marker})`).join("; ")}{unassigned.length>8?"…":""}.</p></div>}
    <div className="flex flex-wrap items-start justify-between gap-3 text-xs leading-5 text-[#718294]"><p>Última lectura: {timestamp(data.selected!.syncedAt)}. Una asistencia por persona y día en las sedes elegidas.<br/>{data.selected!.manualToday? `Registros manuales de hoy: ${data.selected!.manualToday}. Se cuentan una sola vez aunque aparezcan en la planilla.` : "Para los ceros se usa el estado A, N o R del padrón de ese mes."}</p><div className="flex flex-wrap gap-3">{data.selected!.sources.map(s=><a key={s.branchId} href={`https://docs.google.com/spreadsheets/d/${s.spreadsheetId}/edit`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm underline">Abrir {defaultBranches.find(b=>b.id===s.branchId)?.name.replace("Vukova ","")??s.sheetName}<ArrowUpRight className="size-4"/></a>)}</div></div>
    <AttendanceDetail person={detail} period={a.period} branchId={data.viewBranch} close={()=>setDetail(null)} onSaved={()=>{setDetail(null);refresh();}}/>
  </>;
}

function AttendanceDetail({person,period,branchId,close,onSaved}:{person:AnalyticsPerson|null;period:string;branchId:string;close:()=>void;onSaved:()=>void}) {
  const [showLink,setShowLink]=React.useState(false);const [choices,setChoices]=React.useState<MemberChoice[]>([]);const [memberId,setMemberId]=React.useState("");const [source,setSource]=React.useState("");const [search,setSearch]=React.useState("");const [busy,setBusy]=React.useState(false);const [error,setError]=React.useState("");const [loadingChoices,setLoadingChoices]=React.useState(false);
  React.useEffect(()=>{setShowLink(false);setMemberId(person?.memberId??"");setSource(person?.sourceNames[0]??"");setSearch("");setError("");},[person]);
  React.useEffect(()=>{if(!showLink||branchId==="all")return;const controller=new AbortController();setLoadingChoices(true);setError("");fetch(`/api/members?branch=${encodeURIComponent(branchId)}`,{signal:controller.signal}).then(async response=>{const body=await response.json() as {error?:string;members:MemberChoice[]};if(!response.ok)throw new Error(body.error??"No se pudieron cargar los socios.");setChoices(body.members);}).catch(e=>{if(e.name!=="AbortError")setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoadingChoices(false);});return()=>controller.abort();},[showLink,branchId]);
  async function save(){if(!source||!memberId)return;setBusy(true);setError("");try{const response=await fetch("/api/attendance/link",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:source,memberId,branchId})});const body=await response.json() as {error?:string};if(!response.ok)throw new Error(body.error??"No se pudo guardar.");onSaved();}catch(e){setError(e instanceof Error?e.message:"No se pudo guardar.");}finally{setBusy(false);}}
  return <Dialog open={!!person} onOpenChange={open=>{if(!open)close();}}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>{person?.displayName}</DialogTitle><DialogDescription className="capitalize">{month(period)} · {person?.monthlyTotal??0} asistencias</DialogDescription></DialogHeader>{person&&<>
    <div className="flex flex-wrap gap-2">{person.dates.length?person.dates.map(d=><span key={d} className="rounded-lg bg-[#eef2f6] px-3 py-2 text-sm">{date(d,{weekday:"short",day:"numeric",month:"short"})}</span>):<p className="text-sm text-[#516476]">Sin presentes registrados en este mes.</p>}</div>
    {person.reviewDates.length>0&&<div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><p className="font-semibold">Marcas pendientes de confirmar</p>{person.reviewDates.map(d=><p key={d}>{d}</p>)}<p className="mt-2">Corregí estas marcas en la planilla. Se incorporarán en la próxima sincronización.</p></div>}
    {!person.memberId&&!person.otherBranch&&<p className="text-sm text-amber-900">Falta identificar la ficha correspondiente a este asistente.</p>}
    {person.needsReview&&person.memberId&&!person.reviewDates.length&&<p className="text-sm text-amber-900">La ficha del padrón tiene datos de identidad o estado por revisar. Podés consultarla en Socios.</p>}
    {person.duplicates>0&&<p className="text-sm text-[#516476]">Los presentes repetidos del mismo día se cuentan una sola vez.</p>}
    {!!person.sourceNames.length&&branchId==="all"&&<p className="border-t pt-4 text-sm text-[#516476]">Seleccioná una sede para corregir la vinculación de esta asistencia.</p>}
    {!!person.sourceNames.length&&branchId!=="all"&&<div className="border-t pt-4"><Button variant="outline" onClick={()=>setShowLink(v=>!v)} aria-expanded={showLink}>{showLink?"Ocultar vinculación":person.needsReview?"Revisar vinculación del nombre":"Ver origen o corregir vínculo"}</Button>{showLink&&<div className="mt-4 space-y-3"><label className="block text-sm font-medium">Nombre en la planilla<select className={`${selectClass} mt-1`} value={source} onChange={e=>setSource(e.target.value)}>{person.sourceNames.map(n=><option key={n} value={n}>{n}</option>)}</select></label><Input placeholder="Buscar ficha del socio" aria-label="Buscar ficha para vincular" value={search} onChange={e=>setSearch(e.target.value)}/><label className="block text-sm font-medium">Ficha correspondiente<select className={`${selectClass} mt-1`} value={memberId} onChange={e=>setMemberId(e.target.value)} disabled={loadingChoices}><option value="">{loadingChoices?"Cargando socios…":"Seleccionar socio"}</option>{choices.filter(m=>m.id===memberId||normalize(m.name).includes(normalize(search))).map(m=><option key={m.id} value={m.id}>{m.name} · {m.service==="gym"?"Gimnasio":"Pileta"}</option>)}</select></label>{error&&<p role="alert" className="text-sm text-red-700">{error}</p>}<Button disabled={busy||loadingChoices||!memberId||!source} onClick={save}>{busy?"Guardando…":"Guardar vínculo"}</Button></div>}</div>}
  </>}</DialogContent></Dialog>;
}
