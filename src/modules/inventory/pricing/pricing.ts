/**
 * Formación de precios: COSTO → PRECIO sin IVA → PVP → PVP con descuento.
 *
 *   costo total  = costo × (1 + gastos de traída)
 *   precio s/IVA = costo total × (1 + ganancia objetivo) ÷ (1 − comisiones)
 *   PVP          = precio + IVA del producto, con el redondeo del negocio
 *
 * Las comisiones son lo que se descuenta de cada venta (vendedor, punto de
 * venta, financiadora…). El IVA no es comisión: se suma aparte. El PVP se
 * redondea y de ahí se saca el precio sin IVA que se guarda, para que lo que
 * ve el cliente quede exacto.
 */
import { withTax } from "@/core/tax";

export type Rounding = "none" | "99" | "90" | "int";

export interface PricingConcept {
  name: string;
  pct: number;
  active: boolean;
}

export interface PricingPolicy {
  target_margin: number;
  overhead_pct: number;
  concepts: PricingConcept[];
  min_margin: number;
  rounding: Rounding;
}

export const DEFAULT_POLICY: PricingPolicy = {
  target_margin: 30,
  overhead_pct: 0,
  concepts: [],
  min_margin: 15,
  rounding: "none",
};

export const ROUNDING_LABEL: Record<Rounding, string> = {
  none: "Sin redondeo",
  "99": "Terminar en ,99",
  "90": "Terminar en ,90",
  int: "Número entero",
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Suma de comisiones activas, como fracción (0,05 = 5 %). */
export function feesRate(policy: PricingPolicy): number {
  return policy.concepts.filter((c) => c.active).reduce((a, c) => a + Number(c.pct), 0) / 100;
}

/** Costo con los gastos de traída. */
export function landedCost(cost: number, policy: PricingPolicy): number {
  return cost * (1 + Number(policy.overhead_pct) / 100);
}

/** Redondeo comercial hacia arriba: nunca baja el precio calculado. */
export function roundPvp(value: number, rounding: Rounding): number {
  if (!(value > 0)) return 0;
  const v = round2(value);
  switch (rounding) {
    case "99":
      return round2(Math.ceil(v - 0.99 - 1e-9) + 0.99);
    case "90":
      return round2(Math.ceil(v - 0.9 - 1e-9) + 0.9);
    case "int":
      return Math.ceil(v - 1e-9);
    default:
      return v;
  }
}

/** Precio sin IVA que, con el IVA, da ese PVP (o el más cercano por encima). */
export function netFromPvp(pvp: number, taxRate: number): number {
  let net = round2(pvp / (1 + taxRate / 100));
  // El redondeo del IVA puede dejarlo un centavo corto o largo.
  while (withTax(net, taxRate) < pvp) net = round2(net + 0.01);
  while (net > 0 && withTax(round2(net - 0.01), taxRate) >= pvp) net = round2(net - 0.01);
  return net;
}

export interface Breakdown {
  cost: number;
  overhead: number;
  landed: number;
  profit: number;
  concepts: { name: string; pct: number; amount: number }[];
  /** Precio sin IVA antes del redondeo. */
  rawNet: number;
  /** Precio sin IVA que se guarda. */
  net: number;
  tax: number;
  pvp: number;
}

/** Precio sugerido para un costo. Null si no hay costo o las comisiones se comen todo. */
export function suggestPrice(cost: number | null | undefined, policy: PricingPolicy, taxRate: number): Breakdown | null {
  if (cost == null || !(Number(cost) > 0)) return null;
  const fees = feesRate(policy);
  if (fees >= 0.9) return null;
  const c = Number(cost);
  const landed = landedCost(c, policy);
  const withProfit = landed * (1 + Number(policy.target_margin) / 100);
  const rawNet = withProfit / (1 - fees);
  const pvp = roundPvp(withTax(round2(rawNet), taxRate), policy.rounding);
  const net = netFromPvp(pvp, taxRate);
  return {
    cost: c,
    overhead: round2(landed - c),
    landed: round2(landed),
    profit: round2(withProfit - landed),
    concepts: policy.concepts.filter((x) => x.active).map((x) => ({ name: x.name, pct: Number(x.pct), amount: round2((rawNet * Number(x.pct)) / 100) })),
    rawNet: round2(rawNet),
    net,
    tax: round2(pvp - net),
    pvp,
  };
}

/** Ganancia que deja un precio sin IVA después de comisiones y costo total. */
export function profitAt(net: number, cost: number, policy: PricingPolicy): { amount: number; pct: number } {
  const landed = landedCost(cost, policy);
  const amount = net * (1 - feesRate(policy)) - landed;
  return { amount: round2(amount), pct: landed > 0 ? Math.round((amount / landed) * 1000) / 10 : 0 };
}

/** Precio sin IVA mínimo para no perder. */
export function breakEven(cost: number, policy: PricingPolicy): number {
  const fees = feesRate(policy);
  return fees >= 1 ? Infinity : landedCost(cost, policy) / (1 - fees);
}

/** Descuento máximo (%) sobre el precio de lista sin entrar en pérdida. */
export function maxDiscountNoLoss(regular: number, cost: number, policy: PricingPolicy): number {
  if (!(regular > 0)) return 0;
  return Math.max(0, Math.floor((1 - breakEven(cost, policy) / regular) * 1000) / 10);
}

/** Porcentaje con coma decimal: 1,5. */
export const pct = (n: number) => Number(n).toLocaleString("es-VE", { maximumFractionDigits: 1 });

export type PriceStatus = "sin_costo" | "sin_fijar" | "revisar" | "perdida" | "margen_bajo" | "fijado";

export const PRICE_STATUS_LABEL: Record<PriceStatus, string> = {
  sin_costo: "Sin costo",
  sin_fijar: "Sin fijar",
  revisar: "Revisar",
  perdida: "Pérdida",
  margen_bajo: "Margen bajo",
  fijado: "Fijado",
};

export const PRICE_STATUS_HELP: Record<PriceStatus, string> = {
  sin_costo: "Falta el costo: sin él no hay precio sugerido.",
  sin_fijar: "Tiene costo pero no precio.",
  revisar: "El costo cambió desde que se fijó el precio.",
  perdida: "El precio vigente no cubre el costo y las comisiones.",
  margen_bajo: "La ganancia queda por debajo del mínimo de la política.",
  fijado: "Precio en orden.",
};

export interface PricedVariant {
  cost: number | null;
  priced_cost: number | null;
  regular_price: number | null;
  price: number | null;
}

/** Estado del precio de una variante según la política. */
export function priceStatus(v: PricedVariant, policy: PricingPolicy): PriceStatus {
  const cost = v.cost == null ? null : Number(v.cost);
  if (cost == null || !(cost > 0)) return "sin_costo";
  if (v.regular_price == null) return "sin_fijar";
  if (v.priced_cost != null && Number(v.priced_cost) !== cost) return "revisar";
  const effective = Number(v.price ?? v.regular_price);
  const p = profitAt(effective, cost, policy);
  if (p.amount < 0) return "perdida";
  if (p.pct < Number(policy.min_margin)) return "margen_bajo";
  return "fijado";
}
