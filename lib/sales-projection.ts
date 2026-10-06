export type SalesPlanScenario = {
  id: string; period: string; saleOn: string; branchId: string; planId: string; planLabel: string;
  service: string; currency: string; months: number; installments: number; method: string;
  planStartsOn?: string | null; terminal?: string | null; cardInstallments?: number | null;
  quantity: number; amountCents: number; surchargeBps: number; salesVatPpm: number;
  collectionFeePpm: number | null; collectionFeeVatPpm: number | null;
  financingFeePpm: number | null; financingFeeVatPpm: number | null;
  otherCostPpm: number | null; otherTaxPpm: number | null; iibbRetentionPpm: number | null;
  fixedCostCents: number | null; accreditationDays: number | null; provider: string | null;
  memberId?: string | null; memberName?: string | null; origin?: string;
  updatedBy: string; updatedAt: string;
};
export const terminalLabels = { cash: "Efectivo", transfer: "Transferencia", nave: "NAVE", mercado_pago: "Mercado Pago" } as const;
export type PaymentTerminal = keyof typeof terminalLabels;
export function scenarioTerminal(s: Pick<SalesPlanScenario,"method"|"terminal"|"provider">): PaymentTerminal | null {
  if (s.method === "cash" || s.method === "transfer") return s.method;
  if (s.terminal === "nave" || s.terminal === "mercado_pago") return s.terminal;
  const provider = s.provider?.trim().toLowerCase();
  return provider === "nave" ? "nave" : provider === "mercado pago" || provider === "mercadopago" ? "mercado_pago" : null;
}
// Business projection rules supplied by the owner, including existing scenarios.
export function normalizeSaleTaxes(s: SalesPlanScenario): SalesPlanScenario {
  const terminal = scenarioTerminal(s);
  if (s.method === "card") return { ...s, terminal, salesVatPpm: 210000 };
  return { ...s, terminal, cardInstallments: null, provider: null, accreditationDays: 0,
    salesVatPpm: s.method === "cash" ? 0 : 210000, collectionFeePpm: 0, collectionFeeVatPpm: 0,
    financingFeePpm: 0, financingFeeVatPpm: 0, otherCostPpm: 0, otherTaxPpm: 0, iibbRetentionPpm: 0, fixedCostCents: 0 };
}
const percent = (amount: number, ppm: number) => Math.round(amount * ppm / 1000000);
const daysInMonth = (period:string) => new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5,7)),0)).getUTCDate();
function shiftPeriod(period:string,months:number){const [year,month]=period.split("-").map(Number);const date=new Date(Date.UTC(year,month-1+months,1));return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}`;}
function dateAtDay(period:string,day:number){return `${period}-${String(day).padStart(2,"0")}`;}
function addDays(iso: string, count: number) {
  const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + count); return d.toISOString().slice(0, 10);
}
function monthDate(iso: string, months: number) {
  const period = shiftPeriod(iso.slice(0, 7), months);
  return dateAtDay(period, Math.min(Number(iso.slice(8)), daysInMonth(period)));
}
export type SalesPlanSchedule = { scenario: SalesPlanScenario; contractCents: number; saleCashCents: number; receiptPeriod: string; receiptCents: number };

export function scheduleSalesPlan(s: SalesPlanScenario): SalesPlanSchedule {
  const installment = Math.round(s.amountCents * (10000 + s.surchargeBps) / 10000);
  const contractCents = installment * s.installments * s.quantity;
  const card = s.method === "card";
  const receiptDate = card ? addDays(s.saleOn, s.accreditationDays ?? 0) : s.saleOn;
  const receiptCents = card ? contractCents : installment * s.quantity;
  return { scenario: s, contractCents, saleCashCents: receiptCents, receiptPeriod: receiptDate.slice(0, 7), receiptCents };
}

export type SalesMonthlyTotals = {
  period: string; contractValueCents: number; incomingGrossCents: number; salesVatCents: number;
  collectionFeeCents: number; collectionFeeVatCents: number; financingFeeCents: number;
  financingFeeVatCents: number; otherCostCents: number; otherTaxCents: number;
  iibbRetentionCents: number; fixedCostCents: number; netCashCents: number | null;
  incompleteLines: number; scenarioCount: number;
};
export function salesMonthlyTotals(rows: SalesPlanScenario[], period: string): SalesMonthlyTotals {
  const result: SalesMonthlyTotals = { period, contractValueCents: 0, incomingGrossCents: 0, salesVatCents: 0,
    collectionFeeCents: 0, collectionFeeVatCents: 0, financingFeeCents: 0, financingFeeVatCents: 0,
    otherCostCents: 0, otherTaxCents: 0, iibbRetentionCents: 0, fixedCostCents: 0,
    netCashCents: 0, incompleteLines: 0, scenarioCount: 0 };
  let missingCost = false;
  const add = (s: SalesPlanScenario, amount: number) => {
    if (amount <= 0) return;
    result.scenarioCount++;
    result.incomingGrossCents += amount;
    result.salesVatCents += percent(amount, s.salesVatPpm);
    const fee = (bps: number | null) => bps === null ? null : percent(amount, bps);
    const collectionFee = fee(s.collectionFeePpm), collectionVat = fee(s.collectionFeeVatPpm);
    const financingFee = s.method === "card" ? fee(s.financingFeePpm) : 0;
    const financingVat = s.method === "card" ? fee(s.financingFeeVatPpm) : 0;
    const otherCost = fee(s.otherCostPpm), otherTax = fee(s.otherTaxPpm), retention = fee(s.iibbRetentionPpm);
    const fixed = s.fixedCostCents === null ? null : s.fixedCostCents * s.quantity;
    if ([collectionFee, collectionVat, financingFee, financingVat, otherCost, otherTax, retention, fixed].some(v => v === null)) {
      missingCost = true; result.incompleteLines++;
    }
    result.collectionFeeCents += collectionFee ?? 0;
    result.collectionFeeVatCents += collectionVat ?? 0;
    result.financingFeeCents += financingFee ?? 0;
    result.financingFeeVatCents += financingVat ?? 0;
    result.otherCostCents += otherCost ?? 0;
    result.otherTaxCents += otherTax ?? 0;
    result.iibbRetentionCents += retention ?? 0;
    result.fixedCostCents += fixed ?? 0;
    // Card processor fees are withheld from the one settlement; direct-payment fees
    // (if any) are taken on each monthly installment. Retentions reduce cash but
    // remain separately reported as tax credits pending the applicable filing.
  };
  for (const row of rows) {
    const s = normalizeSaleTaxes(row);
    const installmentCents = Math.round(s.amountCents * (10000 + s.surchargeBps) / 10000);
    const transactionMonths = s.method === "card" ? [0] : Array.from({ length: s.installments }, (_, i) => i);
    for (const n of transactionMonths) {
      const receiptDate = s.method === "card" ? addDays(s.saleOn, s.accreditationDays ?? 0) : n === 0 ? s.saleOn : monthDate(s.planStartsOn ?? s.saleOn, n);
      if (receiptDate.slice(0, 7) !== period) continue;
      const amount = s.method === "card" ? installmentCents * s.installments * s.quantity : installmentCents * s.quantity;
      add(s, amount);
    }
  }
  if (missingCost) result.netCashCents = null;
  else result.netCashCents = result.incomingGrossCents - result.salesVatCents - result.collectionFeeCents - result.collectionFeeVatCents -
    result.financingFeeCents - result.financingFeeVatCents - result.otherCostCents - result.otherTaxCents - result.iibbRetentionCents - result.fixedCostCents;
  return result;
}

export function monthlySaleValue(rows: SalesPlanScenario[], period: string, currency?: string) {
  return rows.filter(s => s.period === period && (!currency || s.currency === currency)).reduce((sum,s) => sum + scheduleSalesPlan(s).contractCents, 0);
}
