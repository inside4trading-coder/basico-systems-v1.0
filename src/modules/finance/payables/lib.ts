/** Estados y filtros de cuentas por pagar para la UI (sin red, para probarlos). */
import type { Payable } from "./api";

export interface PayableInstallmentLike {
  due_date: string;
  amount: number;
  paid: number;
}

export type PayableInstallmentState = "paid" | "overdue" | "partial" | "pending";

export const PAYABLE_INSTALLMENT_LABEL: Record<PayableInstallmentState, string> = {
  paid: "Pagada",
  overdue: "Vencida",
  partial: "Abonada",
  pending: "Pendiente",
};

export const PAYABLE_STATUS_LABEL: Record<Payable["status"], string> = { open: "Abierta", paid: "Pagada", cancelled: "Anulada" };

const round2 = (v: number) => Math.round(v * 100) / 100;

export function payableInstallmentLeft(i: PayableInstallmentLike): number {
  return Math.max(round2(i.amount - i.paid), 0);
}

export function payableInstallmentState(i: PayableInstallmentLike, today: string): PayableInstallmentState {
  if (payableInstallmentLeft(i) <= 0.005) return "paid";
  if (i.due_date < today) return "overdue";
  return i.paid > 0 ? "partial" : "pending";
}

export function payableLeft(p: Pick<Payable, "amount" | "paid" | "status">): number {
  return p.status === "open" ? Math.max(round2(p.amount - p.paid), 0) : 0;
}

/** La próxima cuota con saldo (la más vieja primero). */
export function nextPayableDue<T extends PayableInstallmentLike>(installments: T[]): T | undefined {
  return [...installments].filter((i) => payableInstallmentLeft(i) > 0.005).sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
}

export function isPayableOverdue(p: Pick<Payable, "status" | "installments">, today: string): boolean {
  return p.status === "open" && p.installments.some((i) => i.due_date < today && payableInstallmentLeft(i) > 0.005);
}

/** Días entre dos fechas AAAA-MM-DD (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

/** Vence dentro de `days` días (incluye hoy) y no está vencida. */
export function isPayableDueSoon(p: Pick<Payable, "status" | "installments">, today: string, days = 7): boolean {
  if (p.status !== "open" || isPayableOverdue(p, today)) return false;
  const next = nextPayableDue(p.installments);
  return Boolean(next && daysBetween(today, next.due_date) <= days);
}

export type PayableFilter = "open" | "overdue" | "due_soon" | "paid" | "cancelled" | "all";

export const PAYABLE_FILTER_LABEL: Record<PayableFilter, string> = {
  open: "Abiertas",
  overdue: "Vencidas",
  due_soon: "Vencen en 7 días",
  paid: "Pagadas",
  cancelled: "Anuladas",
  all: "Todas",
};

export function matchesPayableFilter(p: Payable, f: PayableFilter, today: string): boolean {
  switch (f) {
    case "open":
      return p.status === "open";
    case "overdue":
      return isPayableOverdue(p, today);
    case "due_soon":
      return isPayableDueSoon(p, today);
    case "paid":
      return p.status === "paid";
    case "cancelled":
      return p.status === "cancelled";
    case "all":
      return true;
  }
}

export function matchesPayableSearch(p: Payable, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [p.supplier?.name, p.supplier?.tax_id, p.document, p.control_number, p.category].some((v) => v?.toLowerCase().includes(needle));
}

/** Texto de vencimiento de una factura abierta: "Vencida hace 5 días", "Vence hoy", "Vence en 3 días". */
export function dueLabel(dueDate: string, today: string): string {
  const d = daysBetween(today, dueDate);
  if (d < 0) return `Vencida hace ${-d} ${d === -1 ? "día" : "días"}`;
  if (d === 0) return "Vence hoy";
  return `Vence en ${d} ${d === 1 ? "día" : "días"}`;
}

/** Fecha más días, en AAAA-MM-DD. */
export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
