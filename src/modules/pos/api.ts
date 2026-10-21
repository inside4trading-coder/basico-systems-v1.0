/**
 * Caja y venta. El servidor calcula precios, tasa, impuestos e IGTF; aquí solo
 * se arma qué se vende y cómo se paga. Portado de useSublimeCashSession.ts y
 * del cobro de SublimePosApp.tsx (basicosystems@f551478b).
 */
import type { SaleItemPayload } from "./cart";
import type { SaleCustomer } from "@/modules/customers/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";
import { withOfflineCache } from "@/core/offline";

export interface Register {
  id: string;
  location_id: string;
  name: string;
  code: string;
  is_active: boolean;
}

export interface CashSession {
  id: string;
  register_id: string;
  location_id: string;
  number: string;
  status: "open" | "closed";
  opened_by: string;
  opened_at: string;
  closed_at: string | null;
}

export interface CashLine {
  currency: string;
  opening: number;
  expected: number;
  counted: number | null;
  difference: number | null;
}

export interface SessionSummary {
  session_id: string;
  number: string;
  status: "open" | "closed";
  opened_at: string;
  closed_at: string | null;
  cash: CashLine[];
  sales: { count: number; total: number; discount: number; tax: number; igtf: number };
  voided?: { count: number; total: number };
  returns?: { count: number; total: number };
  by_method: { method: string; currency: string; amount: number; amount_base: number }[];
}

/** Línea de venta: variante del catálogo o concepto manual (descuento en moneda base). */
export type SaleItemInput = SaleItemPayload;

export interface SalePaymentInput {
  payment_method_id: string;
  amount: number;
  reference?: string;
  bank?: string;
  extra?: Record<string, string>;
}

export interface RegisterSaleInput {
  idempotencyKey: string;
  sessionId: string;
  items: SaleItemInput[];
  payments: SalePaymentInput[];
  cartDiscount?: number;
  change?: { currency: string; amount: number } | null;
  customer?: SaleCustomer | null;
  note?: string | null;
  /** Solo ventas cobradas sin conexión: hora del cobro (ISO). */
  soldAt?: string;
  /** Origen de la venta (tienda, WhatsApp…). */
  channelId?: string | null;
  /** Personal de caja que atendió. */
  cashierId?: string | null;
}

export interface RegisterSaleResult {
  sale_id: string;
  number: string;
  total: number;
  igtf: number;
  rate: number | null;
  duplicate: boolean;
}

function useTenantKey() {
  const { active } = useTenant();
  return active?.tenant.id ?? "none";
}

function asError(error: { message?: string } | null): Error {
  return new Error(error?.message ?? "Error desconocido");
}

/** Clave para que reintentar el mismo cobro no duplique la venta. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function useRegisters() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["pos", tenant, "registers"],
    queryFn: withOfflineCache(`registers:${tenant}`, async () => {
      const { data, error } = await supabase.from("registers").select("id, location_id, name, code, is_active").order("code");
      if (error) throw error;
      return (data ?? []) as Register[];
    }),
  });
}

export function useSaveRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<Register> & { id?: string }) => {
      const { id, ...fields } = input;
      const payload = { ...fields, ...(fields.code ? { code: fields.code.trim().toUpperCase() } : {}) };
      const { error } = id ? await supabase.from("registers").update(payload).eq("id", id) : await supabase.from("registers").insert(payload);
      if (error) throw asError(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pos"] }),
  });
}

/** Sesiones abiertas del negocio (una por caja como máximo). */
export function useOpenSessions() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["pos", tenant, "open_sessions"],
    queryFn: withOfflineCache(`open_sessions:${tenant}`, async () => {
      const { data, error } = await supabase.from("cash_sessions").select("*").eq("status", "open").order("opened_at");
      if (error) throw error;
      return (data ?? []) as CashSession[];
    }),
  });
}

export function useSessionSummary(sessionId: string | null) {
  const tenant = useTenantKey();
  return useQuery({
    enabled: Boolean(sessionId),
    queryKey: ["pos", tenant, "summary", sessionId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("cash_session_summary", { p_session_id: sessionId });
      if (error) throw asError(error);
      return data as SessionSummary;
    },
  });
}

export function useOpenSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ registerId, opening, note }: { registerId: string; opening: { currency: string; amount: number }[]; note?: string }) => {
      const { data, error } = await supabase.rpc("open_cash_session", { p_register_id: registerId, p_opening: opening, p_note: note ?? null });
      if (error) throw asError(error);
      return data as { session_id: string; number: string };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pos"] }),
  });
}

export function useCashMovement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { sessionId: string; kind: "cash_in" | "cash_out"; currency: string; amount: number; note: string }) => {
      const { error } = await supabase.rpc("cash_movement", {
        p_session_id: input.sessionId,
        p_kind: input.kind,
        p_currency: input.currency,
        p_amount: input.amount,
        p_note: input.note,
      });
      if (error) throw asError(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pos"] }),
  });
}

export function useCloseSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ sessionId, counted, note }: { sessionId: string; counted: { currency: string; amount: number }[]; note?: string }) => {
      const { data, error } = await supabase.rpc("close_cash_session", { p_session_id: sessionId, p_counted: counted, p_note: note ?? null });
      if (error) throw asError(error);
      return data as SessionSummary;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pos"] }),
  });
}

export async function registerSale(input: RegisterSaleInput): Promise<RegisterSaleResult> {
  const { data, error } = await supabase.rpc("register_sale", {
    p_idempotency_key: input.idempotencyKey,
    p_session_id: input.sessionId,
    p_items: input.items,
    p_payments: input.payments,
    p_cart_discount: input.cartDiscount ?? 0,
    p_change: input.change ?? null,
    p_customer: input.customer ?? null,
    p_note: input.note ?? null,
    ...(input.soldAt ? { p_sold_at: input.soldAt } : {}),
    ...(input.channelId ? { p_channel_id: input.channelId } : {}),
    ...(input.cashierId ? { p_cashier_id: input.cashierId } : {}),
  });
  if (error) throw asError(error);
  return data as RegisterSaleResult;
}

export function useRegisterSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: registerSale,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pos"] });
      qc.invalidateQueries({ queryKey: ["inv"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Búsqueda para el carrito y venta guardada (recibo)
// ---------------------------------------------------------------------------

export interface PosHit {
  variant_id: string;
  product_id: string;
  product_name: string;
  options: Record<string, string>;
  brand: string | null;
  sku: string | null;
  price: number | null;
  unit: string;
  match_kind: string;
  available: number;
  tax_rate: number;
  /** Solo en el catálogo con el buscador vacío. */
  image_url?: string | null;
  category?: string | null;
}

export interface PosCatalog {
  categories: string[];
  items: PosHit[];
}

/** Lo que se vende en la sede, lo más vendido primero (public.pos_catalog). */
export async function fetchPosCatalog(locationId: string, category: string | null): Promise<PosCatalog> {
  const { data, error } = await supabase.rpc("pos_catalog", { p_location_id: locationId, p_category: category, p_limit: 60 });
  if (error) throw asError(error);
  const r = (data ?? { categories: [], items: [] }) as PosCatalog;
  return {
    categories: r.categories ?? [],
    items: (r.items ?? []).map((h) => ({
      ...h,
      options: h.options ?? {},
      price: h.price === null ? null : Number(h.price),
      available: Number(h.available),
      tax_rate: Number(h.tax_rate),
    })),
  };
}

export function usePosCatalog(locationId: string, category: string | null, enabled: boolean) {
  const { active } = useTenant();
  return useQuery({
    enabled,
    queryKey: ["pos", active?.tenant.id, "catalog", locationId, category],
    queryFn: () => fetchPosCatalog(locationId, category),
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });
}

/**
 * catalog_lookup más lo que el carrito necesita para la vista previa:
 * disponible en la sede de la caja y tasa de impuesto del producto.
 */
export async function searchForPos(query: string, locationId: string): Promise<PosHit[]> {
  const { data, error } = await supabase.rpc("catalog_lookup", { p_query: query, p_limit: 30 });
  if (error) throw asError(error);
  const hits = (data ?? []) as Omit<PosHit, "available" | "tax_rate">[];
  if (hits.length === 0) return [];

  const variantIds = hits.map((h) => h.variant_id);
  const productIds = [...new Set(hits.map((h) => h.product_id))];
  const [stocks, products, taxes] = await Promise.all([
    supabase.from("stocks").select("variant_id, available").eq("location_id", locationId).in("variant_id", variantIds),
    supabase.from("products").select("id, tax_rate_id, image_url").in("id", productIds),
    supabase.from("tax_rates").select("id, rate, is_default"),
  ]);
  if (stocks.error) throw asError(stocks.error);
  if (products.error) throw asError(products.error);
  if (taxes.error) throw asError(taxes.error);

  const available = new Map((stocks.data ?? []).map((s) => [s.variant_id as string, Number(s.available)]));
  const taxById = new Map((taxes.data ?? []).map((t) => [t.id as string, Number(t.rate)]));
  const defaultTax = Number((taxes.data ?? []).find((t) => t.is_default)?.rate ?? 0);
  const taxOfProduct = new Map(
    (products.data ?? []).map((p) => [p.id as string, p.tax_rate_id ? (taxById.get(p.tax_rate_id) ?? defaultTax) : defaultTax]),
  );

  const imageOfProduct = new Map((products.data ?? []).map((p) => [p.id as string, (p.image_url as string | null) ?? null]));

  return hits.map((h) => ({
    ...h,
    price: h.price === null ? null : Number(h.price),
    available: available.get(h.variant_id) ?? 0,
    tax_rate: taxOfProduct.get(h.product_id) ?? defaultTax,
    image_url: imageOfProduct.get(h.product_id) ?? null,
  }));
}

export interface SaleReceipt {
  id: string;
  number: string;
  status: string;
  sold_at: string;
  base_currency: string;
  local_currency: string | null;
  rate: number | null;
  prices_include_tax: boolean;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  igtf_total: number;
  paid_total: number;
  change_total: number;
  customer_name: string | null;
  customer_doc: string | null;
  note: string | null;
  items: { line: number; description: string; sku: string | null; qty: number; unit_price: number; discount: number; tax_rate: number; line_total: number }[];
  payments: { method_name: string; currency: string; amount: number; amount_base: number; igtf_base: number; reference: string | null; bank: string | null }[];
}

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

/** El recibo sale de la venta guardada, nunca del carrito. */
export async function fetchSaleReceipt(saleId: string): Promise<SaleReceipt> {
  const { data, error } = await supabase
    .from("sales")
    .select(
      "id, number, status, sold_at, base_currency, local_currency, rate, prices_include_tax, subtotal, discount_total, tax_total, total, igtf_total, paid_total, change_total, customer_name, customer_doc, note, sale_items(line, description, sku, qty, unit_price, discount, tax_rate, line_total), sale_payments(method_name, currency, amount, amount_base, igtf_base, reference, bank)",
    )
    .eq("id", saleId)
    .single();
  if (error) throw asError(error);
  const row = data as Record<string, unknown> & { sale_items: Record<string, unknown>[]; sale_payments: Record<string, unknown>[] };
  return {
    ...(row as unknown as SaleReceipt),
    rate: row.rate === null ? null : Number(row.rate),
    subtotal: num(row.subtotal),
    discount_total: num(row.discount_total),
    tax_total: num(row.tax_total),
    total: num(row.total),
    igtf_total: num(row.igtf_total),
    paid_total: num(row.paid_total),
    change_total: num(row.change_total),
    items: row.sale_items
      .map((i) => ({
        line: num(i.line),
        description: String(i.description),
        sku: (i.sku as string | null) ?? null,
        qty: num(i.qty),
        unit_price: num(i.unit_price),
        discount: num(i.discount),
        tax_rate: num(i.tax_rate),
        line_total: num(i.line_total),
      }))
      .sort((a, b) => a.line - b.line),
    payments: row.sale_payments.map((p) => ({
      method_name: String(p.method_name),
      currency: String(p.currency),
      amount: num(p.amount),
      amount_base: num(p.amount_base),
      igtf_base: num(p.igtf_base),
      reference: (p.reference as string | null) ?? null,
      bank: (p.bank as string | null) ?? null,
    })),
  };
}
