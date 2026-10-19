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
  by_product: { variant_id: string; name: string; sku: string | null; qty: number; net: number; profit: number | null; costed: boolean }[];
  by_method: { method: string; currency: string; count: number; amount: number; amount_base: number }[];
  by_seller: { seller: string; tickets: number; net: number }[];
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
