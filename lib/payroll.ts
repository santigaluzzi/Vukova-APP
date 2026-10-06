export type WorkEntry = { id:string; employeeId:string; branchId:string; workOn:string; minutes:number; workRole:string; note:string; updatedAt:string };
export type HourlyRate = { id:string; employeeId:string; branchId:string; effectiveFrom:string; amountCents:number };
export type PayrollEmployee = { id:string; name:string; role:string; branchIds:string[]; active:boolean };
export type PayrollSetting = { branchId:string; commissionBps:number };
export type PayrollBonus = { employeeId:string; branchId:string; eligible:number };
export type PayrollSale = { id:string; branchId:string; currency:string; kind:string|null; netCents:number|null };
export type PayrollFund = { branchId:string; currency:string; newSales:number; unknownSales:number; missingNet:number; netCents:number|null; commissionBps:number|null; poolCents:number|null; teacherMinutes:number; unallocatedCents:number|null };
export type PayrollRow = { employeeId:string; name:string; role:string; branchId:string; minutes:number; teacherMinutes:number; teacherTotalMinutes:number; baseCents:number|null; presentismCents:number|null; presentismStatus:"pending"|"yes"|"no"|"not_applicable"; commissions:Record<string,number|null>; totalCents:number|null; pending:string[] };
export type PayrollPayload = { period:string; today:string; scope:"self"|"team"; canManage:boolean; branches:{id:string;name:string}[]; employees:PayrollEmployee[]; entries:WorkEntry[]; rates:HourlyRate[]; rows:PayrollRow[]; funds:PayrollFund[] };

/** Largest remainders preserve every cent of the branch pool, including ties. */
export function allocateCommission(poolCents:number, weights:{id:string;minutes:number}[]):Record<string,number> {
  const positive=weights.filter(w=>w.minutes>0), total=positive.reduce((s,w)=>s+w.minutes,0);
  if (!total) return {};
  const shares=positive.map(w=>{const numerator=BigInt(poolCents)*BigInt(w.minutes),denominator=BigInt(total);return {id:w.id,cents:Number(numerator/denominator),remainder:numerator%denominator};});
  shares.sort((a,b)=>a.remainder===b.remainder?a.id.localeCompare(b.id):a.remainder>b.remainder?-1:1);
  const remaining=poolCents-shares.reduce((sum,s)=>sum+s.cents,0);
  for(let i=0;i<remaining;i++) shares[i].cents++;
  return Object.fromEntries(shares.map(s=>[s.id,s.cents]));
}
export function rateFor(entry:Pick<WorkEntry,"employeeId"|"branchId"|"workOn">, rates:HourlyRate[]) {
  return rates.filter(rate=>rate.employeeId===entry.employeeId&&rate.branchId===entry.branchId&&rate.effectiveFrom<=entry.workOn).sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null;
}
export function calculatePayroll(input:{employees:PayrollEmployee[];entries:WorkEntry[];rates:HourlyRate[];settings:PayrollSetting[];bonuses:PayrollBonus[];sales:PayrollSale[];branchIds:string[]}) {
  const {employees,entries,rates,settings,bonuses,sales,branchIds}=input;
  const groups=new Map<string,PayrollRow>();
  for(const employee of employees) {
    const worked=entries.filter(e=>e.employeeId===employee.id);
    const applicable=[...new Set([...(employee.active&&employee.role!=="admin"?employee.branchIds:[]),...worked.map(e=>e.branchId)])].filter(id=>branchIds.includes(id));
    for(const branchId of applicable) {
      const work=worked.filter(e=>e.branchId===branchId), teacherWork=work.filter(e=>e.workRole==="teacher");
      const valued=work.map(e=>({entry:e,rate:rateFor(e,rates)}));
      const missing=valued.filter(e=>!e.rate).length;
      const base=missing?null:valued.reduce((sum,e)=>sum+Math.round(e.entry.minutes*e.rate!.amountCents/60),0);
      const teacherMissing=valued.some(e=>e.entry.workRole==="teacher"&&!e.rate);
      const teacherBase=teacherMissing?null:valued.filter(e=>e.entry.workRole==="teacher").reduce((sum,e)=>sum+Math.round(e.entry.minutes*e.rate!.amountCents/60),0);
      const bonus=bonuses.find(b=>b.employeeId===employee.id&&b.branchId===branchId);
      const status=teacherWork.length?bonus?(bonus.eligible?"yes":"no"):"pending":"not_applicable";
      const presentism=status==="pending"?null:status==="yes"?(teacherBase===null?null:Math.round(teacherBase/10)):0;
      const pending=[...(missing?[`${missing} registro(s) sin valor hora vigente`]:[]),...(status==="pending"?["Presentismo pendiente de confirmar"]:[])];
      groups.set(`${employee.id}:${branchId}`,{employeeId:employee.id,name:employee.name,role:employee.role,branchId,minutes:work.reduce((s,e)=>s+e.minutes,0),teacherMinutes:teacherWork.reduce((s,e)=>s+e.minutes,0),teacherTotalMinutes:0,baseCents:base,presentismCents:presentism,presentismStatus:status,commissions:{ARS:0},totalCents:null,pending});
    }
  }
  const rows=[...groups.values()],funds:PayrollFund[]=[];
  for(const branchId of branchIds) {
    const branchRows=rows.filter(r=>r.branchId===branchId),weights=branchRows.filter(r=>r.teacherMinutes>0).map(r=>({id:r.employeeId,minutes:r.teacherMinutes}));
    const teacherMinutes=weights.reduce((sum,w)=>sum+w.minutes,0);
    branchRows.forEach(row=>row.teacherTotalMinutes=teacherMinutes);
    const relevant=sales.filter(s=>s.branchId===branchId&&s.kind!=="renewal");
    const commissionBps=settings.find(s=>s.branchId===branchId)?.commissionBps??null;
    for(const currency of [...new Set(["ARS",...relevant.map(s=>s.currency)])]) {
      const transactions=relevant.filter(s=>s.currency===currency),newSales=transactions.filter(s=>s.kind==="new_member"),unknownSales=transactions.filter(s=>!s.kind).length;
      const missingNet=newSales.filter(s=>s.netCents===null).length;
      const netCents=missingNet||unknownSales?null:newSales.reduce((sum,s)=>sum+s.netCents!,0);
      const poolCents=commissionBps===0?0:commissionBps===null||netCents===null?null:Math.max(0,Math.round(netCents*commissionBps/10000));
      const shares=poolCents===null?{}:allocateCommission(poolCents,weights);
      funds.push({branchId,currency,newSales:newSales.length,unknownSales,missingNet,netCents,commissionBps,poolCents,teacherMinutes,unallocatedCents:teacherMinutes?0:poolCents});
      for(const row of branchRows) {
        row.commissions[currency]=row.teacherMinutes?(poolCents===null?null:shares[row.employeeId]??0):0;
        if(row.teacherMinutes&&poolCents===null) row.pending.push(commissionBps===null?"Falta definir el porcentaje de comisiones":unknownSales?"Hay ventas pendientes de clasificar":"Faltan costos para calcular ventas netas");
      }
    }
  }
  for(const row of rows) {
    row.pending=[...new Set(row.pending)];
    row.totalCents=row.baseCents===null||row.presentismCents===null||row.commissions.ARS===null?null:row.baseCents+row.presentismCents+row.commissions.ARS;
  }
  return {rows,funds};
}
