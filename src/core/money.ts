/**
 * Montos en pantalla, recibos y exportaciones.
 *
 * En Venezuela los precios en divisa se muestran como referencia: el símbolo
 * permitido es "REF", nunca "$". El bolívar se muestra como "Bs.". Las demás
 * monedas salen con su código.
 */

export const REF_SYMBOL = "REF";

export function currencySymbol(currency: string): string {
  switch (currency) {
    case "USD":
    case "USDT":
      return REF_SYMBOL;
    case "VES":
      return "Bs.";
    default:
      return currency;
  }
}

export function formatAmount(value: number | null | undefined): string {
  return Number(value ?? 0).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatMoney(value: number | null | undefined, currency: string): string {
  return `${currencySymbol(currency)} ${formatAmount(value)}`;
}

export function formatRate(rate: number): string {
  return rate.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Fecha corta de la tasa ("21 oct"), a partir de "AAAA-MM-DD". */
export function formatRateDate(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("es-VE", { day: "numeric", month: "short", timeZone: "UTC" }).replace(".", "");
}

/** Efectivo físico: los billetes en divisa se nombran por su moneda ("USD"), no como referencia. */
export function cashCurrencyLabel(currency: string): string {
  return currency === "VES" ? "Bs." : currency;
}
