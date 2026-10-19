/**
 * Administración: etiquetas y reglas sin red. Portado de src/types/admin.ts
 * (computeUrgency), adminConstants.ts, AdminCalendar.tsx, AdminKPIs.tsx y
 * useAdminData.ts (basicosystems@f551478b).
 */

export type AccountKind = "bank" | "cash" | "wallet" | "processor" | "other";
export type Frequency = "once" | "weekly" | "biweekly" | "monthly" | "bimonthly" | "quarterly" | "semiannual" | "annual";
export type MovementKind = "manual" | "transfer" | "sale" | "cash_close" | "obligation" | "receivable" | "provider";
export type Importance = "critical" | "high" | "medium" | "low";
export type ObligationStatus = "active" | "paused" | "cancelled";
export type InstanceStatus = "pending" | "partial" | "paid" | "skipped" | "void";

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
  receivable: "Cobranza",
  provider: "Financiadora",
};

export const IMPORTANCE_LABEL: Record<Importance, string> = {
  critical: "Crítica",
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

export const OBLIGATION_STATUS_LABEL: Record<ObligationStatus, string> = {
  active: "Activa",
  paused: "Pausada",
  cancelled: "Cancelada",
};

export const INSTANCE_STATUS_LABEL: Record<InstanceStatus, string> = {
  pending: "Pendiente",
  partial: "Parcial",
  paid: "Pagada",
  skipped: "Omitida",
  void: "Anulada",
};

export function isOpen(status: InstanceStatus): boolean {
  return status === "pending" || status === "partial";
}

export type DueState = "paid" | "skipped" | "void" | "overdue" | "today" | "soon" | "later";

/** Estado de una cuota respecto a hoy (YYYY-MM-DD de Caracas). "soon" = 7 días. */
export function dueState(dueDate: string, status: InstanceStatus, today: string): DueState {
  if (status === "paid") return "paid";
  if (status === "skipped") return "skipped";
  if (status === "void") return "void";
  if (dueDate < today) return "overdue";
  if (dueDate === today) return "today";
  return -daysFrom(dueDate, today) <= 7 ? "soon" : "later";
}

export const DUE_STATE_LABEL: Record<DueState, string> = {
  paid: "Pagada",
  skipped: "Omitida",
  void: "Anulada",
  overdue: "Vencida",
  today: "Vence hoy",
  soon: "Esta semana",
  later: "Próxima",
};

/** Urgencia de una cuota abierta (Sublime: vencida o hoy, 3 días, 7 días, más). */
export function urgency(dueDate: string, today: string): Importance {
  const days = -daysFrom(dueDate, today);
  if (days <= 0) return "critical";
  if (days <= 3) return "high";
  if (days <= 7) return "medium";
  return "low";
}

/** Días de atraso (positivo) o que faltan (negativo). */
export function daysFrom(dueDate: string, today: string): number {
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000);
}

/** "Hoy", "Mañana", "Ayer", "en 5 días", "hace 3 días". */
export function relativeDay(dueDate: string, today: string): string {
  const days = -daysFrom(dueDate, today);
  if (days === 0) return "Hoy";
  if (days === 1) return "Mañana";
  if (days === -1) return "Ayer";
  return days > 1 ? `en ${days} días` : `hace ${Math.abs(days)} días`;
}

export function formatDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("es-VE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** Signo del movimiento sobre el saldo. */
export function signedAmount(m: { direction: "in" | "out"; amount: number }): number {
  return m.direction === "in" ? m.amount : -m.amount;
}

// ---------------------------------------------------------------------------
// Calendario
// ---------------------------------------------------------------------------

/** Mes como "YYYY-MM". */
export function monthOf(day: string): string {
  return day.slice(0, 7);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export function monthLabel(month: string): string {
  const label = new Date(`${month}-15T12:00:00Z`).toLocaleDateString("es-VE", { month: "long", year: "numeric", timeZone: "UTC" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Celdas del mes empezando el lunes; null fuera del mes. Múltiplo de 7. */
export function monthGrid(month: string): (string | null)[] {
  const { from, to } = monthRange(month);
  const first = new Date(`${from}T12:00:00Z`).getUTCDay(); // 0 = domingo
  const offset = (first + 6) % 7;
  const days = Number(to.slice(8));
  const cells: (string | null)[] = Array.from({ length: offset }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

// ---------------------------------------------------------------------------
// Indicadores
// ---------------------------------------------------------------------------

export interface InstanceLike {
  due_date: string;
  amount: number | null;
  paid_amount: number;
  currency: string;
  status: InstanceStatus;
}

/** Lo que falta pagar de una cuota (null si el monto es variable). */
export function remaining(i: InstanceLike): number | null {
  if (i.amount === null) return null;
  return Math.max(0, Math.round((i.amount - i.paid_amount) * 100) / 100);
}

export interface ObligationKpis {
  /** Por moneda: total del mes (sin anuladas ni omitidas). */
  due: Record<string, number>;
  /** Por moneda: lo pagado de las cuotas del mes. */
  paid: Record<string, number>;
  /** Cuotas del mes abiertas. */
  open: number;
  /** Abiertas y vencidas, de cualquier mes. */
  overdue: number;
  /** Abiertas que vencen en los próximos 7 días. */
  upcoming: number;
}

export function obligationKpis(instances: InstanceLike[], month: string, today: string): ObligationKpis {
  const k: ObligationKpis = { due: {}, paid: {}, open: 0, overdue: 0, upcoming: 0 };
  for (const i of instances) {
    const open = isOpen(i.status);
    if (open && i.due_date < today) k.overdue++;
    if (open && i.due_date >= today && -daysFrom(i.due_date, today) <= 7) k.upcoming++;
    if (monthOf(i.due_date) !== month || i.status === "void" || i.status === "skipped") continue;
    if (i.amount !== null) k.due[i.currency] = (k.due[i.currency] ?? 0) + i.amount;
    if (i.paid_amount > 0) k.paid[i.currency] = (k.paid[i.currency] ?? 0) + i.paid_amount;
    if (open) k.open++;
  }
  return k;
}
