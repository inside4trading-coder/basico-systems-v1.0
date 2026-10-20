/**
 * Precios sin IVA y PVP.
 *
 * El negocio escribe el precio sin IVA; el PVP (lo que paga el cliente) es el
 * precio más el IVA del producto, o el del negocio si el producto no tiene uno.
 * Mismo redondeo que register_sale para una unidad.
 */

export interface TaxRateLike {
  id: string;
  rate: number;
  is_default: boolean;
  is_active: boolean;
}

function round2(value: number): number {
  return Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;
}

/** Porcentaje de IVA de un producto: el suyo o el del negocio; 0 si no hay. */
export function productTaxRate(taxRateId: string | null | undefined, rates: TaxRateLike[]): number {
  const own = taxRateId ? rates.find((r) => r.id === taxRateId) : undefined;
  if (own) return Number(own.rate);
  const fallback = rates.find((r) => r.is_default);
  return fallback ? Number(fallback.rate) : 0;
}

/** IVA de un precio sin IVA. */
export function taxOf(net: number, rate: number): number {
  return round2((net * rate) / 100);
}

/** PVP: precio sin IVA más su IVA. */
export function withTax(net: number, rate: number): number {
  return round2(round2(net) + taxOf(net, rate));
}
