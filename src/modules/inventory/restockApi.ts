/** Reposición: reporte y mínimos por producto y sede (report_restock, set_stock_levels). */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";

export interface RestockRow {
  variant_id: string;
  name: string;
  sku: string | null;
  options: Record<string, string>;
  location_id: string;
  location_name: string;
  available: number;
  min_qty: number | null;
  target_qty: number | null;
  sold: number;
  daily: number;
  days_left: number | null;
  suggested: number;
  reason: "min" | "rotacion";
  sources: { location_id: string; name: string; spare: number }[];
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export function useRestock(locationId: string | null, days: number, cover: number) {
  const { active } = useTenant();
  return useQuery({
    queryKey: ["inv", active?.tenant.id, "restock", locationId, days, cover],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("report_restock", { p_location_id: locationId, p_days: days, p_cover_days: cover });
      if (error) throw new Error(error.message);
      return ((data ?? []) as RestockRow[]).map((r) => ({
        ...r,
        available: Number(r.available),
        min_qty: num(r.min_qty),
        target_qty: num(r.target_qty),
        sold: Number(r.sold),
        daily: Number(r.daily),
        days_left: num(r.days_left),
        suggested: Number(r.suggested),
        sources: (r.sources ?? []).map((s) => ({ ...s, spare: Number(s.spare) })),
      }));
    },
  });
}

export function useSetLevels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { variantId: string; locationId: string; min: number | null; target: number | null }) => {
      const { error } = await supabase.rpc("set_stock_levels", {
        p_variant_id: input.variantId,
        p_location_id: input.locationId,
        p_min: input.min,
        p_target: input.target,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inv"] }),
  });
}
