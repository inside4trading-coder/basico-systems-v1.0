/**
 * Reglas de catálogo e inventario, sin acceso a red.
 *
 * Portado de src/lib/sublimeInventory.ts (basicosystems@f551478b) y
 * generalizado: las opciones de variante son libres (no talla/color fijos) y
 * las cantidades pueden ser fraccionarias.
 */

export interface Location {
  id: string;
  tenant_id: string;
  name: string;
  code: string;
  type: "store" | "warehouse" | "popup" | "external";
  sells_in_pos: boolean;
  is_active: boolean;
  /** Se imprimen en la nota de entrega bajo el nombre de la sede. */
  address: string | null;
  phone: string | null;
  /** Ubicación y radio para fichar desde el teléfono (add-on Fichaje). */
  latitude: number | null;
  longitude: number | null;
  clock_radius_m: number;
  deleted_at: string | null;
}

export interface Product {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  description: string | null;
  image_url: string | null;
  tax_rate_id: string | null;
  is_active: boolean;
  deleted_at: string | null;
}

export type VariantOptions = Record<string, string>;

export interface Variant {
  id: string;
  product_id: string;
  options: VariantOptions;
  sku: string | null;
  regular_price: number | null;
  price: number | null;
  discount_pct: number | null;
  cost: number | null;
  unit: string;
  is_active: boolean;
  deleted_at: string | null;
}

export interface Stock {
  id: string;
  variant_id: string;
  location_id: string;
  on_hand: number;
  reserved: number;
  available: number;
  last_counted_at: string | null;
}

export interface ProductCode {
  id: string;
  variant_id: string;
  kind: string;
  code: string;
}

export type MovementKind = "entry" | "adjustment" | "transfer_out" | "transfer_in" | "count" | "sale" | "sale_return";

export interface MovementRow {
  id: string;
  created_at: string;
  variant_id: string;
  location_id: string;
  location_name: string;
  kind: MovementKind;
  qty_before: number;
  qty_delta: number;
  qty_after: number;
  reason: string | null;
  note: string | null;
  supplier: string | null;
  expected_qty: number | null;
  unit_cost: number | null;
  unit_price: number | null;
  transfer_id: string | null;
  corrects_movement_id: string | null;
  signature_status: "n/a" | "pending" | "signed";
  signed_at: string | null;
  signature_note: string | null;
  performed_by: string | null;
  performed_by_email: string | null;
  signed_by_email: string | null;
  sku: string | null;
  options: VariantOptions;
  product_id: string;
  product_name: string;
  brand: string | null;
  category: string | null;
}

export interface LookupResult {
  variant_id: string;
  product_id: string;
  product_name: string;
  options: VariantOptions;
  brand: string | null;
  sku: string | null;
  price: number | null;
  cost: number | null;
  unit: string;
  match_kind: string;
}

export const ADJUST_REASONS: Record<string, string> = {
  dano: "Daño",
  perdida: "Pérdida",
  diferencia_conteo: "Diferencia de conteo",
  error_historico: "Error histórico",
  uso_interno: "Uso interno",
  vencido: "Vencido",
  correccion: "Corrección de ajuste",
  otro: "Otro",
};

export const MOVEMENT_KIND_LABEL: Record<MovementKind, string> = {
  entry: "Entrada",
  adjustment: "Ajuste",
  transfer_out: "Traslado (salida)",
  transfer_in: "Traslado (entrada)",
  count: "Conteo",
  sale: "Venta",
  sale_return: "Devolución",
};

export const MATCH_KIND_LABEL: Record<string, string> = {
  sku: "SKU",
  barcode: "Código de barras",
  texto: "Búsqueda",
};

/** "Talla M · Rojo"; vacío en un producto simple. */
export function variantLabel(options: VariantOptions | null | undefined): string {
  if (!options) return "";
  return Object.values(options)
    .map((v) => String(v).trim())
    .filter(Boolean)
    .join(" · ");
}

/** "Pastillas de freno — Talla M · Rojo" o solo el nombre. */
export function itemLabel(productName: string, options: VariantOptions | null | undefined): string {
  const v = variantLabel(options);
  return v ? `${productName} — ${v}` : productName;
}

/**
 * Convierte "Talla: M, Color: Rojo" en {"Talla":"M","Color":"Rojo"}.
 * Pares sin ":" o con clave vacía se ignoran.
 */
export function parseOptions(text: string): VariantOptions {
  const out: VariantOptions = {};
  for (const part of text.split(",")) {
    const i = part.indexOf(":");
    if (i <= 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key && value) out[key] = value;
  }
  return out;
}

export type SaleBlockReason = "product_inactive" | "variant_inactive" | "no_price" | "no_stock";

export const SALE_BLOCK_LABEL: Record<SaleBlockReason, string> = {
  product_inactive: "Producto inactivo",
  variant_inactive: "Variante inactiva",
  no_price: "Sin precio",
  no_stock: "Sin stock en sedes de venta",
};

/**
 * Lo que impide vender una variante en el POS. Portado de `posBlockers`:
 * el SKU y la talla dejan de bloquear porque no todo rubro los usa; el
 * código de barras o el nombre bastan para encontrarla.
 */
export function saleBlockers(args: {
  product: Pick<Product, "is_active">;
  variant: Pick<Variant, "is_active" | "price" | "regular_price">;
  sellableStock: number;
}): SaleBlockReason[] {
  const out: SaleBlockReason[] = [];
  if (!args.product.is_active) out.push("product_inactive");
  if (!args.variant.is_active) out.push("variant_inactive");
  const price = Number(args.variant.price ?? args.variant.regular_price ?? 0);
  if (!(price > 0)) out.push("no_price");
  if (!(args.sellableStock > 0)) out.push("no_stock");
  return out;
}

export function formatMoney(value: number | null | undefined, currency: string): string {
  const n = Number(value ?? 0);
  try {
    return new Intl.NumberFormat("es-VE", { style: "currency", currency, minimumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

/** Cantidades: enteros sin decimales, fracciones con hasta tres. */
export function formatQty(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  return n.toLocaleString("es-VE", { maximumFractionDigits: 3 });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-VE", { dateStyle: "short", timeStyle: "short" });
}

export function sumStock(stocks: Pick<Stock, "location_id" | "on_hand" | "available">[], locationIds?: Set<string>) {
  return stocks.reduce(
    (acc, s) => {
      if (locationIds && !locationIds.has(s.location_id)) return acc;
      acc.onHand += Number(s.on_hand);
      acc.available += Number(s.available);
      return acc;
    },
    { onHand: 0, available: 0 },
  );
}

export function periodStart(period: "today" | "week" | "month" | "year" | "all", now = new Date()): string | null {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (period === "today") return d.toISOString();
  if (period === "week") {
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.toISOString();
  }
  if (period === "month") {
    d.setDate(1);
    return d.toISOString();
  }
  if (period === "year") {
    d.setMonth(0, 1);
    return d.toISOString();
  }
  return null;
}
