/**
 * Administración: etiquetas y reglas sin red. Portado de src/types/admin.ts
 * (computeUrgency) y useAdminData.ts (basicosystems@f551478b).
 */

export type AccountKind = "bank" | "cash" | "wallet" | "processor" | "other";
export type Frequency = "once" | "weekly" | "biweekly" | "monthly" | "bimonthly" | "quarterly" | "semiannual" | "annual";
export type MovementKind = "manual" | "transfer" | "sale" | "cash_close" | "obligation";

export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  bank: "Banco",
  cash: "Efectivo",
  wallet: "Billetera",
  processor: "Procesador de pagos",
  other: "Otra",
};

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  once: "Una vez",
  weekly: "Semanal",
  biweekly: "Quincenal",
  monthly: "Mensual",
  bimonthly: "Bimestral",
  quarterly: "Trimestral",
  semiannual: "Semestral",
  annual: "Anual",
};

export const MOVEMENT_KIND_LABEL: Record<MovementKind, string> = {
  manual: "Manual",
  transfer: "Transferencia",
  sale: "Venta POS",
  cash_close: "Cierre de caja",
  obligation: "Obligación",
};

export type DueState = "paid" | "skipped" | "overdue" | "today" | "soon" | "later";

/** Estado de una cuota respecto a hoy (YYYY-MM-DD de Caracas). "soon" = 7 días. */
export function dueState(dueDate: string, status: "pending" | "paid" | "skipped", today: string): DueState {
  if (status === "paid") return "paid";
  if (status === "skipped") return "skipped";
  if (dueDate < today) return "overdue";
  if (dueDate === today) return "today";
  const days = (Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
  return days <= 7 ? "soon" : "later";
}

export const DUE_STATE_LABEL: Record<DueState, string> = {
  paid: "Pagada",
  skipped: "Omitida",
  overdue: "Vencida",
  today: "Vence hoy",
  soon: "Esta semana",
  later: "Próxima",
};

/** Días de atraso (positivo) o que faltan (negativo). */
export function daysFrom(dueDate: string, today: string): number {
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000);
}

export function formatDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("es-VE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** Signo del movimiento sobre el saldo. */
export function signedAmount(m: { direction: "in" | "out"; amount: number }): number {
  return m.direction === "in" ? m.amount : -m.amount;
}
