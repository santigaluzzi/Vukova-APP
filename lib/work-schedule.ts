export type WeeklySlot={day:number;hour:number};
export type WorkSchedule={id:string;employeeId:string;branchId:string;effectiveFrom:string;slots:WeeklySlot[];updatedAt:string};
export type DayOverride={id:string;employeeId:string;branchId:string;workOn:string;slots:number[];updatedAt:string};
export type DayPatch={workOn:string;previousSlots:number[];slots:number[]};
export type ShiftChange={id:string;employeeId:string;branchId:string;workOn:string;kind:"change"|"review";patch:DayPatch[];shiftStart:number|null;shiftEnd:number|null;reason:string;status:"pending"|"approved"|"rejected";decisionNote:string|null;decidedAt:string|null;createdAt:string};
export type ShiftRecord={id:string;employeeId:string;branchId:string;workOn:string;startHour:number;endHour:number;status:"confirmed"|"validated"|"absent"|"cancelled";confirmedAt:string|null;note:string};
export type WorkLocation={branchId:string;latitude:number;longitude:number;radiusMeters:number};
export type Turn={start:number;end:number;status:"scheduled"|"in_progress"|"pending_confirmation"|"review"|ShiftRecord["status"];canConfirm:boolean};
export type CalendarDay={employeeId:string;branchId:string;workOn:string;slots:number[];turns:Turn[];plannedMinutes:number;confirmedMinutes:number;legacyMinutes:number;pending:ShiftChange|null};
export type SchedulePayload={period:string;today:string;serverTime:string;branches:{id:string;name:string;location:WorkLocation|null}[];employees:{id:string;name:string;branchIds:string[]}[];schedules:WorkSchedule[];changes:ShiftChange[];days:CalendarDay[]};
export const weekdayLabels=["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
export const statusLabels:Record<Turn["status"],string>={scheduled:"Programado",in_progress:"En curso",pending_confirmation:"Por confirmar",review:"Requiere revisión",confirmed:"Confirmado",validated:"Validado por coordinador",absent:"Ausencia",cancelled:"Cancelado"};
export function weekday(date:string){return new Date(`${date}T12:00:00Z`).getUTCDay();}
export function allowedHours(day:number){return day===0?[]:day===6?[9,10,11]:Array.from({length:14},(_,i)=>i+7);}
export function validDailySlots(slots:unknown,day:number):slots is number[]{return Array.isArray(slots)&&slots.length<=14&&slots.every(h=>typeof h==="number"&&allowedHours(day).includes(h))&&new Set(slots).size===slots.length;}
export function validWeeklySlots(slots:unknown):slots is WeeklySlot[]{return Array.isArray(slots)&&slots.length<=73&&slots.every(s=>s&&typeof s==="object"&&Number.isInteger(s.day)&&s.day>=1&&s.day<=6&&Number.isInteger(s.hour)&&allowedHours(s.day).includes(s.hour))&&new Set(slots.map(s=>`${s.day}:${s.hour}`)).size===slots.length;}
export function sortedHours(slots:number[]){return [...slots].sort((a,b)=>a-b);}
export function sameHours(a:number[],b:number[]){return JSON.stringify(sortedHours(a))===JSON.stringify(sortedHours(b));}
export function activeSchedule(schedules:WorkSchedule[],employeeId:string,branchId:string,date:string){return schedules.filter(s=>s.employeeId===employeeId&&s.branchId===branchId&&s.effectiveFrom<=date).sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom))[0];}
export function plannedHours(schedules:WorkSchedule[],overrides:DayOverride[],employeeId:string,branchId:string,date:string){const override=overrides.find(o=>o.employeeId===employeeId&&o.branchId===branchId&&o.workOn===date);return override?sortedHours(override.slots):sortedHours(activeSchedule(schedules,employeeId,branchId,date)?.slots.filter(s=>s.day===weekday(date)).map(s=>s.hour)??[]);}
export function ranges(slots:number[]){const result:{start:number;end:number}[]=[];for(const hour of sortedHours(slots)){const last=result.at(-1);if(last&&last.end===hour)last.end=hour+1;else result.push({start:hour,end:hour+1});}return result;}
export function slotLabel(slots:number[]){return ranges(slots).map(r=>`${String(r.start).padStart(2,"0")}:00–${String(r.end).padStart(2,"0")}:00`).join(" · ")||"Sin turno";}
export function localHour(now:Date){const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"America/Argentina/Buenos_Aires",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now);return Number(parts.find(p=>p.type==="hour")!.value)+Number(parts.find(p=>p.type==="minute")!.value)/60;}
export function turnState(day:string,start:number,end:number,today:string,hour:number):Turn["status"]{if(day>today)return "scheduled";if(day<today)return "review";if(hour<start)return "scheduled";if(hour<end)return "in_progress";if(hour<=end+1)return "pending_confirmation";return "review";}
export function distanceMeters(lat:number,lng:number,targetLat:number,targetLng:number){const rad=Math.PI/180,dLat=(targetLat-lat)*rad,dLng=(targetLng-lng)*rad;const a=Math.sin(dLat/2)**2+Math.cos(lat*rad)*Math.cos(targetLat*rad)*Math.sin(dLng/2)**2;return 6371000*2*Math.atan2(Math.sqrt(a),Math.sqrt(Math.max(0,1-a)));}
