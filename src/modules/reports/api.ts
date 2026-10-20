/**
 * Reportes del negocio activo. Cada pantalla es una sola llamada a una función
 * de la base (supabase/migrations/20261024000000_reports.sql) que ya devuelve
 * todo agregado; solo dueños, administradores y encargados.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";
import type { DateRange } from "./dates";

export interface SalesKpis {
  tickets: number;
  units: number;
  gross: number;
  discount: number;
  tax: number;
  net: number;
  igtf: number;
  offline: number;
  lines: number;
  lines_costed: number;
  net_costed: number;
  cost: number;
  /** Devoluciones registradas en el periodo (restan de lo vendido) y ventas anuladas. */
  returns?: number;
  returns_total?: number;
  voided?: number;
}

export interface SalesReport {
  from: string;
  to: string;
  summary: SalesKpis;
  previous: SalesKpis;
  by_day: { day: string; tickets: number; net: number }[];
  by_hour: { hour: number; tickets: number; net: number }[];
  by_location: { location_id: string; name: string; tickets: number; net: number }[];
  /** variant_id null y manual true: concepto manual del POS, agrupado por descripción. */
  by_product: { variant_id: string | null; manual?: boolean; name: string; sku: string | null; qty: number; net: number; profit: number | null; costed: boolean }[];
  by_method: { method: string; currency: string; count: number; amount: number; amount_base: number }[];
  by_seller: { seller: string; tickets: number; net: number }[];
  /** Origen de la venta; "Sin origen" agrupa las ventas sin él. */
  by_channel?: { channel: string; tickets: number; net: number }[];
}

export interface StockValueReport {
  by_location: { location_id: string; name: string; skus: number; units: number; cost_value: number; retail_value: number; missing_cost: number }[];
  top: { variant_id: string; name: string; sku: string | null; options: Record<string, string>; units: number; cost: number | null; price: number | null; cost_value: number | null; retail_value: number | null }[];
}

export interface SlowMover {
  variant_id: string;
  name: string;
  sku: string | null;
  options: Record<string, string>;
  location_id: string;
  location_name: string;
  on_hand: number;
  cost_value: number | null;
  last_sold_at: string | null;
  first_stocked_at: string | null;
}

export type StockSegment = "quiebre" | "por_romper" | "alta_rotacion_poco_stock" | "clase_a_en_riesgo" | "sobrestock" | "sin_rotacion";

export interface StockHealthRow {
  variant_id: string;
  name: string;
  sku: string | null;
  options: Record<string, string>;
  location_id: string;
  location_name: string;
  abc_class: "A" | "B" | "C";
  sold: number;
  revenue: number;
  daily: number;
  available: number;
  /** Días que alcanza lo disponible; null sin ventas en el periodo. */
  cover: number | null;
  min_qty: number | null;
  target_qty: number | null;
  suggested: number | null;
  price: number | null;
  cost: number | null;
  days_at_zero: number | null;
  /** Venta perdida estimada (solo quiebre). */
  lost_sales: number | null;
  /** Sugerido × precio: lo que falta para cubrir, a precio de venta. */
  at_risk: number;
  /** A costo (sobrestock y sin rotación). */
  immobilized: number | null;
  /** El más urgente de `segments`. */
  segment: StockSegment;
  segments: StockSegment[];
}

export interface StockHealthReport {
  days: number;
  cover_days: number;
  /** Por segmento: filas, monto en riesgo o inmovilizado, y filas sin precio o costo. */
  summary: Record<StockSegment, { count: number; amount: number; missing: number }>;
  total: number;
  /** Hasta 1000, lo más urgente primero. */
  rows: StockHealthRow[];
}

export interface CashCount {
  currency: string;
  opening: number;
  expected: number;
  counted: number | null;
  difference: number | null;
}

export interface CashClosure {
  session_id: string;
  number: string;
  status: "open" | "closed";
  register_name: string;
  location_name: string;
  opened_at: string;
  closed_at: string | null;
  opened_by: string | null;
  closed_by: string | null;
  closing_note: string | null;
  sales_count: number;
  sales_total: number;
  offline_count: number;
  counts: CashCount[];
  by_method: { method: string; currency: string; amount: number; amount_base: number }[];
  has_difference: boolean;
}

function useTenantKey() {
  const { active } = useTenant();
  return active?.tenant.id ?? "none";
}

/** PostgREST devuelve numeric como string o number: todo a number. */
function numbers<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((v) => numbers(v)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) && !["sku", "number", "day", "name"].includes(k) ? Number(v) : numbers(v),
      ]),
    ) as T;
  }
  return value as T;
}

function asError(error: { message?: string } | null): Error {
  return new Error(error?.message ?? "Error desconocido");
}

export function useSalesReport(range: DateRange, locationId: string | null) {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["reports", tenant, "sales", range.from, range.to, locationId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("report_sales", { p_from: range.from, p_to: range.to, p_location_id: locationId });
      if (error) throw asError(error);
      return numbers<SalesReport>(data);
    },
  });
}

export function useStockValue(locationId: string | null) {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["reports", tenant, "stock", locationId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("report_stock_value", { p_location_id: locationId });
      if (error) throw asError(error);
      return numbers<StockValueReport>(data);
    },
  });
}

export function useSlowMovers(days: number, locationId: string | null) {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["reports", tenant, "slow", days, locationId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("report_slow_movers", { p_days: days, p_location_id: locationId });
      if (error) throw asError(error);
      return numbers<SlowMover[]>(data ?? []);
    },
  });
}

export function useStockHealth(locationId: string | null, days: number, coverDays: number) {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["reports", tenant, "stock-health", locationId, days, coverDays],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("report_stock_health", { p_location_id: locationId, p_days: days, p_cover_days: coverDays });
      if (error) throw asError(error);
      return numbers<StockHealthReport>(data);
    },
  });
}

export function useCashClosures(range: DateRange, locationId: string | null) {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["reports", tenant, "closures", range.from, range.to, locationId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("report_cash_sessions", { p_from: range.from, p_to: range.to, p_location_id: locationId });
      if (error) throw asError(error);
      return numbers<CashClosure[]>(data ?? []);
    },
  });
}
