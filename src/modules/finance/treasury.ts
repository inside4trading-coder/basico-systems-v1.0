/**
 * Resumen de tesorería: periodos y avisos. Portado de useSublimeAdminSummary
 * y del bloque "Requiere tu atención" de SublimeAdminSummary
 * (basicosystems@f551478b); los montos los calcula treasury_summary.
 */
import { formatMoney } from "@/modules/pos/cart";
import { addDays } from "@/modules/reports/dates";

export type TreasuryPeriod = "today" | "week" | "month" | "year" | "all";

export const TREASURY_PERIOD_LABEL: Record<TreasuryPeriod, string> = {
  today: "Hoy",
  week: "Semana",
  month: "Mes",
  year: "Año",
  all: "Todo",
};

/** Desde (null: desde siempre) y hasta hoy. La semana empieza el lunes. */
export function treasuryRange(period: TreasuryPeriod, today: string): { from: string | null; to: string } {
  switch (period) {
    case "today":
      return { from: today, to: today };
    case "week": {
      const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
      return { from: addDays(today, -((weekday + 6) % 7)), to: today };
    }
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "all":
      return { from: null, to: today };
  }
}

export function shareOf(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export interface AttentionInput {
  baseCurrency: string;
  overdueCount: number;
  overdueTotal: number;
  dueSoon: number;
  negativeAccounts: string[];
  /** Métodos de cobro del POS activos sin cuenta: sus ventas no llegan al libro. */
  unlinkedMethods: number;
  rate: "ok" | "stale" | "missing";
  unconvertedMovements: number;
  unconvertedCurrencies: string[];
  /** Líneas del banco sin identificar y con posible coincidencia. */
  bankUnmatched: number;
  bankPossible: number;
}

export type AttentionTarget = "obligations" | "accounts" | "movements" | "reconciliation" | "settings";

export interface AttentionItem {
  id: string;
  tone: "critical" | "warning" | "info";
  title: string;
  detail: string;
  target: AttentionTarget;
}

const TONE_ORDER: Record<AttentionItem["tone"], number> = { critical: 0, warning: 1, info: 2 };

export function attentionItems(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  if (input.overdueCount > 0) {
    items.push({
      id: "overdue",
      tone: "critical",
      title: `${plural(input.overdueCount, "cuota vencida", "cuotas vencidas")} sin pagar`,
      detail: input.overdueTotal > 0 ? `Faltan ${formatMoney(input.overdueTotal, input.baseCurrency)}` : "Monto variable",
      target: "obligations",
    });
  }
  if (input.negativeAccounts.length > 0) {
    items.push({
      id: "negative",
      tone: "critical",
      title: `${plural(input.negativeAccounts.length, "cuenta", "cuentas")} en negativo`,
      detail: input.negativeAccounts.join(", "),
      target: "accounts",
    });
  }
  if (input.rate !== "ok") {
    items.push({
      id: "rate",
      tone: input.rate === "missing" ? "critical" : "warning",
      title: input.rate === "missing" ? "Sin tasa de cambio" : "La tasa no se ha actualizado",
      detail: input.rate === "missing" ? "Los montos en moneda local no se suman a la liquidez" : "Revisa la tasa vigente antes de convertir",
      target: "settings",
    });
  }
  if (input.unconvertedMovements > 0 || input.unconvertedCurrencies.length > 0) {
    const parts = [
      input.unconvertedMovements > 0 ? plural(input.unconvertedMovements, "movimiento", "movimientos") : null,
      input.unconvertedCurrencies.length > 0 ? `saldos en ${input.unconvertedCurrencies.join(", ")}` : null,
    ].filter(Boolean);
    items.push({
      id: "unconverted",
      tone: "info",
      title: "Montos sin convertir",
      detail: `${parts.join(" y ")} no entran en los totales`,
      target: "movements",
    });
  }
  if (input.bankUnmatched > 0 || input.bankPossible > 0) {
    const total = input.bankUnmatched + input.bankPossible;
    items.push({
      id: "bank",
      tone: "warning",
      title: `${plural(total, "movimiento del banco", "movimientos del banco")} por conciliar`,
      detail: [
        input.bankUnmatched > 0 ? `${input.bankUnmatched} sin identificar` : null,
        input.bankPossible > 0 ? plural(input.bankPossible, "posible coincidencia", "posibles coincidencias") : null,
      ]
        .filter(Boolean)
        .join(" · "),
      target: "reconciliation",
    });
  }
  if (input.dueSoon > 0) {
    items.push({
      id: "due_soon",
      tone: "warning",
      title: `${plural(input.dueSoon, "cuota vence", "cuotas vencen")} en 7 días`,
      detail: "Prepara el pago",
      target: "obligations",
    });
  }
  if (input.unlinkedMethods > 0) {
    items.push({
      id: "unlinked",
      tone: "info",
      title: `${plural(input.unlinkedMethods, "método de cobro", "métodos de cobro")} sin cuenta`,
      detail: "Sus ventas no entran al libro",
      target: "accounts",
    });
  }
  return items.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
}
