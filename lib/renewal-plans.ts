export type PaymentMethod = "cash" | "transfer" | "card";
export type RenewalPlan = {
  id: string; label: string; service: "gym" | "pool"; branches: "standard" | "vilo" | "all" | "acassuso";
  months: number; installments: number; amountCents: number; currency: "ARS" | "USD";
  methods: PaymentMethod[]; surcharge: number;
};
const cash: PaymentMethod[] = ["cash", "transfer"];
const all: PaymentMethod[] = ["cash", "transfer", "card"];
function gym(id: string, label: string, branches: "standard" | "vilo", months: number, installments: number, amount: number, card = false): RenewalPlan {
  return { id, label, branches, months, installments, amountCents: amount * 100, currency: "ARS", service: "gym", methods: card ? ["card"] : cash, surcharge: card ? 0 : 10 };
}
export const renewalPlans: RenewalPlan[] = [
  gym("gym-1", "Gimnasio · 1 mes", "standard", 1, 1, 150000),
  gym("gym-6-2", "Gimnasio · 6 meses · 2 pagos", "standard", 6, 2, 360000),
  gym("gym-6-3", "Gimnasio · 6 meses · 3 pagos", "standard", 6, 3, 270000),
  gym("gym-6-card", "Gimnasio · 6 meses · tarjeta en 6 cuotas", "standard", 6, 6, 145000, true),
  gym("gym-12-1", "Gimnasio · 12 meses · 1 pago", "standard", 12, 1, 1080000),
  gym("gym-12-2", "Gimnasio · 12 meses · 2 pagos", "standard", 12, 2, 560000),
  gym("gym-12-card", "Gimnasio · 12 meses · tarjeta en 6 cuotas", "standard", 12, 6, 240000, true),
  gym("vilo-1", "Gimnasio · 1 mes", "vilo", 1, 1, 125000),
  gym("vilo-6-3", "Gimnasio · 6 meses · 3 pagos", "vilo", 6, 3, 200000),
  gym("vilo-6-4", "Gimnasio · 6 meses · 4 pagos", "vilo", 6, 4, 160000),
  gym("vilo-6-card", "Gimnasio · 6 meses · tarjeta en 6 cuotas", "vilo", 6, 6, 115000, true),
  gym("vilo-12-1", "Gimnasio · 12 meses · 1 pago", "vilo", 12, 1, 960000),
  gym("vilo-12-2", "Gimnasio · 12 meses · 2 pagos", "vilo", 12, 2, 520000),
  gym("vilo-12-card", "Gimnasio · 12 meses · tarjeta en 6 cuotas", "vilo", 12, 6, 200000, true),
  { id: "personal-1", label: "Personalizado 1 a 1 · 1 mes", branches: "standard", service: "gym", months: 1, installments: 1, amountCents: 30000, currency: "USD", methods: ["cash"], surcharge: 0 },
  ...[["yoga-1", "Yoga · 1 mes · 2 veces por semana", 1, 1, 100000], ["yoga-6-2", "Yoga · 6 meses · 2 pagos", 6, 2, 240000], ["yoga-6-3", "Yoga · 6 meses · 3 pagos", 6, 3, 176000]].map(([id, label, months, installments, amount]) => ({ id: String(id), label: String(label), months: Number(months), installments: Number(installments), amountCents: Number(amount) * 100, branches: "all" as const, service: "gym" as const, currency: "ARS" as const, methods: all, surcharge: 15 })),
  ...[["swim-1", "Natación niños / adultos · 1 vez por semana", 70000], ["swim-2", "Natación niños / adultos · 2 veces por semana", 80000], ["swim-3", "Natación niños / adultos · 3 veces por semana", 90000], ["baby-1", "Natación bebés · 1 vez por semana", 85000], ["baby-2", "Natación bebés · 2 veces por semana", 100000], ["free-1", "Pileta libre · 1 vez por semana", 65000], ["free-2", "Pileta libre · 2 veces por semana", 76000], ["free-3", "Pileta libre · 3 veces por semana", 90000], ["aqua-1", "Aquagym · 1 vez por semana", 52000], ["aqua-2", "Aquagym · 2 veces por semana", 60000]].map(([id, label, amount]) => ({ id: `pool-${id}`, label: String(label), months: 1, installments: 1, amountCents: Number(amount) * 100, branches: "acassuso" as const, service: "pool" as const, currency: "ARS" as const, methods: all, surcharge: 15 })),
];
export function plansFor(member: { branchId: string; service: string }) {
  return renewalPlans.filter(p => p.service === member.service && (p.service !== "pool" || member.branchId === "branch-acassuso") && (p.branches === "all" || p.branches === "acassuso" && member.branchId === "branch-acassuso" || p.branches === "vilo" && member.branchId === "branch-vilo" || p.branches === "standard" && member.branchId !== "branch-vilo"));
}
export type RenewalScenario = {
  memberId: string; period: string; dueOn: string; planId: string;
  method: PaymentMethod; amountCents: number; probability: number; cardCostBps: number | null; included: boolean;
};
export function quoteRenewal(plan: RenewalPlan, method: PaymentMethod, amountCents = plan.amountCents, probability = 100, cardCostBps: number | null = null) {
  const recargo = method === "cash" ? 0 : plan.surcharge;
  const installmentCents = Math.round(amountCents * (100 + recargo) / 100);
  const totalCents = installmentCents * plan.installments;
  const collectionCents = method === "card" ? totalCents : installmentCents;
  const weightedCents = Math.round(collectionCents * probability / 100);
  const afterCardCostsCents = method !== "card" ? weightedCents : cardCostBps === null ? null : Math.round(weightedCents * (10000 - cardCostBps) / 10000);
  return { currency: plan.currency, installmentCents, totalCents, collectionCents, weightedCents, afterCardCostsCents, recargo };
}
