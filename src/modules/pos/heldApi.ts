/** Carritos en espera: lectura, apartar y retomar (tabla pos_held_carts). */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";

export interface HeldCart<T> {
  id: string;
  label: string;
  payload: T;
  items: number;
  total: number;
  created_at: string;
}

function useKey(locationId: string) {
  const { active } = useTenant();
  return ["pos", active?.tenant.id ?? "none", "held", locationId];
}

export function useHeldCarts<T>(locationId: string, enabled: boolean) {
  const key = useKey(locationId);
  return useQuery({
    enabled,
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pos_held_carts")
        .select("id, label, payload, items, total, created_at")
        .eq("location_id", locationId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return (data ?? []).map((c) => ({ ...c, total: Number(c.total) })) as HeldCart<T>[];
    },
    refetchInterval: 30_000,
  });
}

export function useHoldCart(locationId: string) {
  const qc = useQueryClient();
  const key = useKey(locationId);
  return useMutation({
    mutationFn: async (input: { label: string; payload: object; items: number; total: number }) => {
      const { error } = await supabase.from("pos_held_carts").insert({ location_id: locationId, ...input });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
}

/** Retomar = borrarlo de la espera; si otro lo retomó antes, no vuelve nada. */
export function useResumeCart<T>(locationId: string) {
  const qc = useQueryClient();
  const key = useKey(locationId);
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from("pos_held_carts").delete().eq("id", id).select("payload");
      if (error) throw new Error(error.message);
      if (!data?.length) throw new Error("Ese carrito ya lo retomó otra caja");
      return data[0].payload as T;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

export function notifyHoldError(err: Error) {
  toast.error("No se pudo", { description: err.message });
}
