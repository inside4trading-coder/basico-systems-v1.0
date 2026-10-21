import type { LinkCandidate } from "../api";

export function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Filtro del buscador: referencia, monto, concepto, cuenta o moneda. */
export function matchesCandidate(m: LinkCandidate, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [m.reference, m.category, m.counterparty, m.note, m.account_name, m.currency, String(m.amount), m.amount.toFixed(2).replace(".", ","), m.occurred_on]
    .some((v) => String(v ?? "").toLowerCase().includes(q));
}
