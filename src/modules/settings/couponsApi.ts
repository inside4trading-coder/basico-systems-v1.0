import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";

export interface Coupon {
  id: string;
  code: string;
  description: string | null;
  kind: "percent" | "amount";
  value: number;
  min_purchase: number;
  starts_on: string | null;
  ends_on: string | null;
  max_uses: number | null;
  is_active: boolean;
}

export interface CouponUsage {
  coupon_id: string;
  uses: number;
  discount_total: number;
}

function asError(error: { message?: string } | null): Error {
  return new Error(error?.message ?? "Error desconocido");
}

export function useCoupons() {
  const tenant = useTenant().active?.tenant.id ?? "none";
  return useQuery({
    queryKey: ["cfg", tenant, "coupons"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("coupons")
        .select("id, code, description, kind, value, min_purchase, starts_on, ends_on, max_uses, is_active")
        .order("created_at", { ascending: false });
      if (error) throw asError(error);
      return (data ?? []).map((c) => ({ ...c, value: Number(c.value), min_purchase: Number(c.min_purchase) })) as Coupon[];
    },
  });
}

export function useCouponUsage() {
  const tenant = useTenant().active?.tenant.id ?? "none";
  return useQuery({
    queryKey: ["cfg", tenant, "coupon_usage"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("coupon_usage");
      if (error) throw asError(error);
      return (data ?? []) as CouponUsage[];
    },
  });
}

export function useSaveCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<Coupon> & { id?: string }) => {
      const { id, code, ...fields } = input;
      const { error } = id
        ? await supabase.from("coupons").update(fields).eq("id", id)
        : await supabase.from("coupons").insert({ ...fields, code });
      if (error) throw asError(error.code === "23505" ? { message: "Ya existe un cupón con ese código" } : error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cfg"] }),
  });
}

/** Consulta del POS: el cupón y su descuento para la compra. */
export async function validateCoupon(code: string, base: number) {
  const { data, error } = await supabase.rpc("validate_coupon", { p_code: code, p_base: base });
  if (error) throw asError(error);
  return data as { id: string; code: string; description: string | null; kind: "percent" | "amount"; value: number; min_purchase: number; discount: number };
}
