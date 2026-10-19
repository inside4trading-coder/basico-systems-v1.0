/** Estados de cuotas y cuentas por cobrar para la UI. */

export interface InstallmentLike {
  due_date: string;
  amount: number;
  collected: number;
  covered: number;
}

export type InstallmentState = "paid" | "covered" | "overdue" | "partial" | "pending";

export const INSTALLMENT_STATE_LABEL: Record<InstallmentState, string> = {
  paid: "Cobrada",
  covered: "Cubierta",
  overdue: "Vencida",
  partial: "Abonada",
  pending: "Pendiente",
};

export function installmentLeft(i: InstallmentLike): number {
  return Math.max(Math.round((i.amount - i.collected - i.covered) * 100) / 100, 0);
}

export function installmentState(i: InstallmentLike, today: string): InstallmentState {
  if (installmentLeft(i) <= 0.005) return i.covered > 0 && i.collected <= 0.005 ? "covered" : "paid";
  if (i.due_date < today) return "overdue";
  return i.collected > 0 || i.covered > 0 ? "partial" : "pending";
}

/** Lo que vence o venció y sigue abierto, ordenado por fecha. */
export function nextDue<T extends InstallmentLike>(installments: T[]): T | undefined {
  return [...installments].filter((i) => installmentLeft(i) > 0.005).sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
}

/** Cuotas iguales cada `everyDays` días desde `firstDue`; la última absorbe el redondeo. */
export function splitInstallments(total: number, count: number, firstDue: string, everyDays: number): { due_date: string; amount: number }[] {
  const n = Math.max(1, Math.min(60, Math.floor(count)));
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / n);
  return Array.from({ length: n }, (_, k) => {
    const d = new Date(`${firstDue}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + k * everyDays);
    const amount = (k === n - 1 ? cents - base * (n - 1) : base) / 100;
    return { due_date: d.toISOString().slice(0, 10), amount };
  });
}
