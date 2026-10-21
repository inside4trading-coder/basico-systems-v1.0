/**
 * Carrito y cobro del POS, sin acceso a red.
 *
 * Portado de src/components/sublime/pos/usePosCart.ts y del resumen de
 * PosPaymentSheet.tsx (basicosystems@f551478b). Es solo una vista previa: el
 * total que vale es el que devuelve register_sale. Por eso las cuentas siguen
 * el mismo orden y redondeo que el servidor (app.register_sale):
 *   1. bruto por línea = round(precio × cantidad, 2), menos su descuento;
 *   2. descuento del carrito repartido en proporción; la última línea se lleva
 *      el resto del redondeo;
 *   3. impuesto por línea, incluido en el precio o sumado según el negocio;
 *   4. pagos convertidos a la moneda base con la tasa; IGTF = base - base/(1+r).
 */

export type ManualKind = "producto" | "servicio" | "extra";

export interface CartLine {
  /** Variante del catálogo, o "manual-…" para un concepto que no viene del inventario. */
  variantId: string;
  productId: string;
  name: string;
  options: Record<string, string>;
  sku: string | null;
  unit: string;
  /** Precio unitario en moneda base. */
  price: number;
  /** Porcentaje de impuesto del producto (16, 8, 0…). */
  taxRate: number;
  qty: number;
  /** Descuento de la línea en moneda base. */
  discount: number;
  /** Disponible en la sede al momento de agregarlo; null si no se sabe. */
  available: number | null;
  /** Concepto manual: tipo e impuesto elegido (null = el del negocio). */
  manual?: { kind: ManualKind; taxRateId: string | null };
}

export type SaleItemPayload =
  | { variant_id: string; qty: number; discount?: number }
  | { manual: true; kind: ManualKind; description: string; price: number; qty: number; discount?: number; tax_rate_id: string | null };

/** Líneas del carrito como las recibe register_sale. */
export function saleItems(lines: CartLine[]): SaleItemPayload[] {
  return lines.map((l) =>
    l.manual
      ? { manual: true, kind: l.manual.kind, description: l.name, price: l.price, qty: l.qty, discount: l.discount, tax_rate_id: l.manual.taxRateId }
      : { variant_id: l.variantId, qty: l.qty, discount: l.discount },
  );
}

export interface LineTotals {
  variantId: string;
  gross: number;
  discount: number;
  cartShare: number;
  tax: number;
  total: number;
}

export interface CartTotals {
  subtotal: number;
  lineDiscounts: number;
  cartDiscount: number;
  discount: number;
  tax: number;
  total: number;
  units: number;
  lines: LineTotals[];
}

export function round2(value: number): number {
  return Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;
}

export function cartTotals(lines: CartLine[], cartDiscount: number, pricesIncludeTax: boolean): CartTotals {
  const base = lines.map((l) => {
    const gross = round2(l.price * l.qty);
    return { line: l, gross, discount: Math.min(round2(l.discount), gross) };
  });
  const subtotal = round2(base.reduce((a, b) => a + b.gross, 0));
  const lineDiscounts = round2(base.reduce((a, b) => a + b.discount, 0));
  const afterLines = round2(subtotal - lineDiscounts);
  const cartDisc = Math.min(Math.max(0, round2(cartDiscount)), afterLines);

  let remaining = cartDisc;
  let tax = 0;
  let total = 0;
  const out: LineTotals[] = base.map((b, i) => {
    let share: number;
    if (i === base.length - 1) share = remaining;
    else if (afterLines > 0) share = round2((cartDisc * (b.gross - b.discount)) / afterLines);
    else share = 0;
    remaining = round2(remaining - share);
    let net = round2(b.gross - b.discount - share);
    let lineTax: number;
    if (pricesIncludeTax) {
      lineTax = round2(net - net / (1 + b.line.taxRate / 100));
    } else {
      lineTax = round2((net * b.line.taxRate) / 100);
      net = round2(net + lineTax);
    }
    tax += lineTax;
    total += net;
    return { variantId: b.line.variantId, gross: b.gross, discount: b.discount, cartShare: share, tax: lineTax, total: net };
  });

  return {
    subtotal,
    lineDiscounts,
    cartDiscount: cartDisc,
    discount: round2(lineDiscounts + cartDisc),
    tax: round2(tax),
    total: round2(total),
    units: lines.reduce((a, l) => a + l.qty, 0),
    lines: out,
  };
}

/** Precio por unidad que paga el cliente (PVP): con el IVA sumado si el precio se carga sin IVA. */
export function shelfPrice(price: number, taxRate: number, pricesIncludeTax: boolean): number {
  if (pricesIncludeTax) return round2(price);
  return round2(round2(price) + round2((price * taxRate) / 100));
}

/** Agrega una unidad (o la cantidad dada) sin pasar del disponible conocido. */
export function addToCart(lines: CartLine[], item: Omit<CartLine, "qty" | "discount">, qty = 1): CartLine[] {
  const found = lines.find((l) => l.variantId === item.variantId);
  if (found) return setQty(lines, item.variantId, found.qty + qty);
  const capped = item.available === null ? qty : Math.min(qty, item.available);
  if (capped <= 0) return lines;
  return [...lines, { ...item, qty: capped, discount: 0 }];
}

export function setQty(lines: CartLine[], variantId: string, qty: number): CartLine[] {
  return lines.flatMap((l) => {
    if (l.variantId !== variantId) return [l];
    const capped = l.available === null ? qty : Math.min(qty, l.available);
    if (!(capped > 0)) return [];
    const gross = round2(l.price * capped);
    return [{ ...l, qty: capped, discount: Math.min(l.discount, gross) }];
  });
}

export function setLineDiscount(lines: CartLine[], variantId: string, discount: number): CartLine[] {
  return lines.map((l) =>
    l.variantId === variantId ? { ...l, discount: Math.min(Math.max(0, round2(discount)), round2(l.price * l.qty)) } : l,
  );
}

export function removeLine(lines: CartLine[], variantId: string): CartLine[] {
  return lines.filter((l) => l.variantId !== variantId);
}

/** Descuento de una línea: monto fijo o porcentaje de su bruto (precio × cantidad). */
export function lineDiscountAmount(mode: "amount" | "percent", value: number, line: Pick<CartLine, "price" | "qty">): number {
  if (!(value > 0)) return 0;
  const gross = round2(line.price * line.qty);
  const raw = mode === "percent" ? (gross * Math.min(value, 100)) / 100 : value;
  return Math.min(round2(raw), gross);
}

/** Descuento del carrito: monto fijo o porcentaje sobre lo que queda tras los descuentos de línea. */
export function cartDiscountAmount(mode: "amount" | "percent", value: number, afterLineDiscounts: number): number {
  if (!(value > 0)) return 0;
  const raw = mode === "percent" ? (afterLineDiscounts * Math.min(value, 100)) / 100 : value;
  return Math.min(round2(raw), round2(afterLineDiscounts));
}

// ---------------------------------------------------------------------------
// Cobro
// ---------------------------------------------------------------------------

export interface MoneySettings {
  baseCurrency: string;
  localCurrency: string | null;
  /** Unidades de moneda local por una de base; null si no hay tasa. */
  rate: number | null;
  isSpecialTaxpayer: boolean;
  igtfRate: number;
}

export interface PaymentMethodLike {
  id: string;
  currency: string;
  kind: string;
  applies_igtf: boolean;
}

export interface PaymentDraft {
  key: string;
  methodId: string;
  amount: number;
  reference?: string;
  bank?: string;
  extra?: Record<string, string>;
}

export function toBase(amount: number, currency: string, s: MoneySettings): number | null {
  if (currency === s.baseCurrency) return round2(amount);
  if (currency === s.localCurrency && s.rate) return round2(amount / s.rate);
  return null;
}

export function fromBase(amountBase: number, currency: string, s: MoneySettings): number | null {
  if (currency === s.baseCurrency) return round2(amountBase);
  if (currency === s.localCurrency && s.rate) return round2(amountBase * s.rate);
  return null;
}

function chargesIgtf(m: PaymentMethodLike, s: MoneySettings): boolean {
  return s.isSpecialTaxpayer && m.applies_igtf && s.igtfRate > 0;
}

/** IGTF contenido en un pago ya convertido a base (mismo cálculo que el servidor). */
export function igtfOf(amountBase: number, m: PaymentMethodLike, s: MoneySettings): number {
  if (!chargesIgtf(m, s)) return 0;
  return round2(amountBase - round2(amountBase / (1 + s.igtfRate / 100)));
}

export interface PaymentSummary {
  /** Suma de los pagos en base, con IGTF. */
  paid: number;
  igtf: number;
  /** Lo que cuenta para la venta: pagado menos IGTF. */
  applied: number;
  missing: number;
  /** Cobrado de más (en base): se devuelve como vuelto. */
  excess: number;
  hasCash: boolean;
  /** Un pago usa una moneda sin tasa vigente. */
  unconvertible: boolean;
}

export function paymentSummary(
  payments: PaymentDraft[],
  methods: PaymentMethodLike[],
  total: number,
  s: MoneySettings,
): PaymentSummary {
  let paid = 0;
  let igtf = 0;
  let hasCash = false;
  let unconvertible = false;
  for (const p of payments) {
    const m = methods.find((x) => x.id === p.methodId);
    if (!m) continue;
    const base = toBase(p.amount, m.currency, s);
    if (base === null) {
      unconvertible = true;
      continue;
    }
    paid += base;
    igtf += igtfOf(base, m, s);
    if (m.kind === "cash") hasCash = true;
  }
  paid = round2(paid);
  igtf = round2(igtf);
  const applied = round2(paid - igtf);
  // Tolerancia del servidor: un centavo por pago.
  const tolerance = 0.01 * Math.max(1, payments.length);
  const diff = round2(total - applied);
  return {
    paid,
    igtf,
    applied,
    missing: diff > tolerance ? diff : 0,
    excess: -diff > tolerance ? -diff : 0,
    hasCash,
    unconvertible,
  };
}

/**
 * Monto a sugerir para cubrir lo que falta con un método, en su moneda. Si el
 * método cobra IGTF, se suma para que lo aplicado alcance.
 */
export function suggestedAmount(missingBase: number, m: PaymentMethodLike, s: MoneySettings): number {
  if (!(missingBase > 0)) return 0;
  let base = missingBase;
  if (chargesIgtf(m, s)) {
    base = round2(missingBase * (1 + s.igtfRate / 100));
    // El redondeo puede dejar un centavo corto: se sube hasta cubrir.
    while (round2(base - igtfOf(base, m, s)) < missingBase) base = round2(base + 0.01);
  }
  if (m.currency === s.baseCurrency) return base;
  if (m.currency === s.localCurrency && s.rate) {
    let local = round2(base * s.rate);
    while (round2(local / s.rate) < base) local = round2(local + 0.01);
    return local;
  }
  return 0;
}

/** Vuelto en la moneda elegida para un excedente en base. */
export function changeIn(excessBase: number, currency: string, s: MoneySettings): number | null {
  return fromBase(excessBase, currency, s);
}

export function formatMoney(value: number, currency: string): string {
  const n = value.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currencySymbol(currency)} ${n}`;
}

export function currencySymbol(currency: string): string {
  switch (currency) {
    case "USD":
      return "$";
    case "VES":
      return "Bs.";
    case "EUR":
      return "€";
    default:
      return currency;
  }
}

export function formatQty(qty: number): string {
  return qty.toLocaleString("es-VE", { maximumFractionDigits: 3 });
}
