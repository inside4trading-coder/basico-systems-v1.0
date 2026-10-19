/**
 * Cálculos de una devolución en el navegador (para mostrar). El servidor
 * (create_sale_return) vuelve a calcular y valida lo mismo.
 */

export interface ReturnableLine {
  id: string;
  qty: number;
  line_total: number;
  returned: number;
}

export function returnableQty(line: ReturnableLine): number {
  return Math.max(Math.round((line.qty - line.returned) * 1000) / 1000, 0);
}

/** Monto proporcional de la línea (con impuestos), como lo calcula el servidor. */
export function returnAmount(line: ReturnableLine, qty: number): number {
  if (!(qty > 0) || line.qty <= 0) return 0;
  return Math.round((line.line_total / line.qty) * qty * 100) / 100;
}

export function returnTotal(lines: ReturnableLine[], picked: Record<string, number>): number {
  return Math.round(lines.reduce((sum, l) => sum + returnAmount(l, Math.min(picked[l.id] ?? 0, returnableQty(l))), 0) * 100) / 100;
}

/** Monto a reintegrar en la moneda del método: la local a la tasa vigente. */
export function refundInCurrency(totalBase: number, currency: string, baseCurrency: string, rate: number | null): number | null {
  if (currency === baseCurrency) return totalBase;
  if (!rate) return null;
  return Math.round(totalBase * rate * 100) / 100;
}
