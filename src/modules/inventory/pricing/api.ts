/** Política de precios, fijación en bloque e historial de precios. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";
import { DEFAULT_POLICY, type PricingPolicy } from "./pricing";

function useTenantKey() {
  const { active } = useTenant();
  return active?.tenant.id ?? "none";
}

export function usePricingPolicy() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["inv", tenant, "pricing_policy"],
    queryFn: async (): Promise<PricingPolicy & { saved: boolean }> => {
      const { data, error } = await supabase
        .from("pricing_policies")
        .select("target_margin, overhead_pct, replacement_pct, concepts, min_margin, rounding, auto_on_cost")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return { ...DEFAULT_POLICY, saved: false };
      return {
        target_margin: Number(data.target_margin),
        overhead_pct: Number(data.overhead_pct),
        replacement_pct: Number(data.replacement_pct ?? 0),
        min_margin: Number(data.min_margin),
        rounding: data.rounding as PricingPolicy["rounding"],
        auto_on_cost: data.auto_on_cost ?? true,
        concepts: ((data.concepts ?? []) as PricingPolicy["concepts"]).map((c) => ({ name: c.name, pct: Number(c.pct), active: !!c.active })),
        saved: true,
      };
    },
  });
}

export function useSavePricingPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (policy: PricingPolicy) => {
      const { error } = await supabase.rpc("save_pricing_policy", { p_policy: policy });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inv"] }),
  });
}

export function useSetPrices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ items, reason }: { items: { variant_id: string; regular_price: number; price_locked?: boolean }[]; reason?: string }) => {
      const { data, error } = await supabase.rpc("set_variant_prices", { p_items: items, p_reason: reason ?? null });
      if (error) throw new Error(error.message);
      return Number(data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inv"] }),
  });
}

export interface PolicyImpact {
  changed: number;
  up: number;
  down: number;
  same: number;
  locked: number;
  no_cost: number;
  applied?: number;
}

/** Cuenta (dryRun) o aplica la política guardada a todo el inventario. */
export function useApplyPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dryRun: boolean): Promise<PolicyImpact> => {
      const { data, error } = await supabase.rpc("apply_pricing_policy", { p_dry_run: dryRun });
      if (error) throw new Error(error.message);
      return data as unknown as PolicyImpact;
    },
    onSuccess: (_d, dryRun) => {
      if (!dryRun) qc.invalidateQueries({ queryKey: ["inv"] });
    },
  });
}

export interface RateChange {
  from: number;
  to: number;
  fromDate: string;
  toDate: string;
  pct: number;
}

/**
 * Cuánto cambió la tasa oficial (BCV) en los últimos 30 días. Solo de
 * referencia para que el negocio decida su ajuste por reposición.
 */
export function useOfficialRateChange() {
  return useQuery({
    queryKey: ["inv", "official_rate_change"],
    staleTime: 60 * 60 * 1000,
    queryFn: async (): Promise<RateChange | null> => {
      const since = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("exchange_rates")
        .select("source, rate, effective_date")
        .eq("base_currency", "USD")
        .eq("quote_currency", "VES")
        .gte("effective_date", since)
        .order("effective_date", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      const source = rows.some((r) => r.source === "bcv") ? "bcv" : "dolarapi";
      const list = rows.filter((r) => r.source === source);
      if (list.length < 2) return null;
      const latest = list[0];
      const cutoff = new Date(new Date(latest.effective_date).getTime() - 30 * 86400000).toISOString().slice(0, 10);
      const past = list.find((r) => r.effective_date <= cutoff) ?? list[list.length - 1];
      if (past === latest) return null;
      const from = Number(past.rate);
      const to = Number(latest.rate);
      return { from, to, fromDate: past.effective_date, toDate: latest.effective_date, pct: Math.round(((to - from) / from) * 1000) / 10 };
    },
  });
}

export interface PriceHistoryRow {
  id: string;
  cost: number | null;
  regular_price: number | null;
  price: number | null;
  reason: string;
  created_at: string;
}

export function usePriceHistory(variantId: string | null) {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["inv", tenant, "price_history", variantId],
    enabled: !!variantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_history")
        .select("id, cost, regular_price, price, reason, created_at")
        .eq("variant_id", variantId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({
        ...r,
        cost: r.cost == null ? null : Number(r.cost),
        regular_price: r.regular_price == null ? null : Number(r.regular_price),
        price: r.price == null ? null : Number(r.price),
      })) as PriceHistoryRow[];
    },
  });
}
