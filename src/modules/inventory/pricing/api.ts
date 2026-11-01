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
        .select("target_margin, overhead_pct, concepts, min_margin, rounding")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return { ...DEFAULT_POLICY, saved: false };
      return {
        target_margin: Number(data.target_margin),
        overhead_pct: Number(data.overhead_pct),
        min_margin: Number(data.min_margin),
        rounding: data.rounding as PricingPolicy["rounding"],
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
    mutationFn: async ({ items, reason }: { items: { variant_id: string; regular_price: number }[]; reason?: string }) => {
      const { data, error } = await supabase.rpc("set_variant_prices", { p_items: items, p_reason: reason ?? null });
      if (error) throw new Error(error.message);
      return Number(data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inv"] }),
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
