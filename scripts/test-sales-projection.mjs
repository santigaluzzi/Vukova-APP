import assert from "node:assert/strict";
import { monthlySaleValue, salesMonthlyTotals } from "../lib/sales-projection.ts";

const common = {
  id:"line-1",period:"2026-10",saleOn:"2026-10-10",branchId:"branch-acassuso",planId:"gym-6-2",planLabel:"Gimnasio · 6 meses · 2 pagos",
  service:"gym",currency:"ARS",months:6,installments:2,method:"transfer",quantity:1,amountCents:36000000,surchargeBps:1000,
  terminal:"transfer",cardInstallments:null,salesVatPpm:210000,collectionFeePpm:29900,collectionFeeVatPpm:0,financingFeePpm:0,financingFeeVatPpm:0,
  otherCostPpm:0,otherTaxPpm:0,iibbRetentionPpm:0,fixedCostCents:0,accreditationDays:0,provider:null,updatedBy:"test",updatedAt:"2026-09-28T12:00:00.000Z",
};
const transfer = common;
assert.equal(monthlySaleValue([transfer],"2026-10"),79200000,"Sale value includes the 10% transfer surcharge and both instalments.");
assert.equal(salesMonthlyTotals([transfer],"2026-10").incomingGrossCents,39600000,"Direct-payment plans collect one instalment in the sale month.");
assert.equal(salesMonthlyTotals([transfer],"2026-10").salesVatCents,8316000,"Sales VAT follows the requested 21% on the amount collected.");
assert.equal(salesMonthlyTotals([transfer],"2026-10").collectionFeeCents,0,"Transfer has no collection commission.");
assert.equal(salesMonthlyTotals([transfer],"2026-10").netCashCents,31284000,"Transfer subtracts only output VAT.");
assert.equal(salesMonthlyTotals([transfer],"2026-11").incomingGrossCents,39600000,"The second direct-payment instalment enters the next month.");
assert.equal(salesMonthlyTotals([transfer],"2026-11").contractValueCents,0,"A prior contract is not counted as a new sale in the second collection month.");
const cash={...common,id:"line-cash",method:"cash",terminal:"cash",salesVatPpm:210000,collectionFeePpm:null,collectionFeeVatPpm:null,otherCostPpm:null,otherTaxPpm:null,iibbRetentionPpm:null,fixedCostCents:null};
assert.equal(salesMonthlyTotals([cash],"2026-10").salesVatCents,0,"Cash has no VAT.");
assert.equal(salesMonthlyTotals([cash],"2026-10").netCashCents,39600000,"Cash is received without tax or fees.");
const card = {...common,id:"line-card",terminal:"nave",cardInstallments:3,planId:"gym-6-card",planLabel:"Gimnasio · 6 meses · tarjeta",method:"card",amountCents:14500000,installments:6,surchargeBps:0,
  collectionFeePpm:53000,collectionFeeVatPpm:11130,financingFeePpm:99000,financingFeeVatPpm:20790,iibbRetentionPpm:4000,accreditationDays:2,provider:"NAVE"};
const cardTotals = salesMonthlyTotals([card],"2026-10");
assert.equal(cardTotals.incomingGrossCents,87000000,"Card receives the full sale as one accreditation.");
assert.equal(cardTotals.salesVatCents,18270000,"Output VAT is calculated on card settlement gross.");
assert.equal(cardTotals.collectionFeeCents,4611000);
assert.equal(cardTotals.collectionFeeVatCents,968310,"Fee VAT retains precision below one basis point.");
assert.equal(cardTotals.financingFeeCents,8613000);
assert.equal(cardTotals.financingFeeVatCents,1808730);
assert.equal(cardTotals.iibbRetentionCents,348000);
assert.equal(cardTotals.netCashCents,52380960,"Net cash subtracts output VAT, provider costs and tax withholding.");
assert.equal(salesMonthlyTotals([card],"2026-11").incomingGrossCents,0,"Card instalments paid by the client never create additional gym receipts.");
const unknown = {...card,id:"unknown-cost",collectionFeePpm:null};
assert.equal(salesMonthlyTotals([unknown],"2026-10").netCashCents,null,"Do not present a net estimate while a payment fee remains unknown.");
assert.equal(salesMonthlyTotals([unknown],"2026-10").incompleteLines,1);
const usd = {...transfer,id:"usd",currency:"USD",planId:"personal-1",method:"cash",amountCents:30000,installments:1,surchargeBps:0,collectionFeePpm:0,collectionFeeVatPpm:0,financingFeePpm:null,financingFeeVatPpm:null};
assert.equal(monthlySaleValue([transfer,usd],"2026-10","ARS"),79200000);
assert.equal(monthlySaleValue([transfer,usd],"2026-10","USD"),30000,"Different currencies must remain separate.");
console.log("PASS: plan value, direct-payment schedule, card settlement, VAT, precision transaction costs, incomplete costs, retention, and separate currencies.");
