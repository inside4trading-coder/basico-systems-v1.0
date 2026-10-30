/**
 * Por pagar a aliados: lo vendido por encargo con la existencia de un aliado
 * comercial, al costo del producto.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";

export type PayableStatus = "pending" | "paid" | "cancelled";

export interface PartnerPayable {
  id: string;
  location_id: string;
  qty: number;
  unit_cost: number | null;
  amount: number | null;
  status: PayableStatus;
  paid_at: string | null;
  created_at: string;
  location: { name: string } | null;
  sale: { number: string; sold_at: string } | null;
  item: { description: string; sku: string | null } | null;
}

export function usePartnerPayables(status: PayableStatus) {
  const { active } = useTenant();
  return useQuery({
    queryKey: ["fin", active?.tenant.id ?? "none", "partner_payables", status],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partner_payables")
        .select(
          "id, location_id, qty, unit_cost, amount, status, paid_at, created_at, location:locations(name), sale:sales(number, sold_at), item:sale_items(description, sku)",
        )
        .eq("status", status)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      return ((data ?? []) as unknown as PartnerPayable[]).map((p) => ({
        ...p,
        qty: Number(p.qty),
        unit_cost: p.unit_cost === null ? null : Number(p.unit_cost),
        amount: p.amount === null ? null : Number(p.amount),
      }));
    },
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["fin"] });
}

export function useMarkPartnerPaid() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { data, error } = await supabase.rpc("partner_payables_mark_paid", { p_ids: ids });
      if (error) throw new Error(error.message);
      return Number(data);
    },
    onSuccess: invalidate,
  });
}

export function useSetPartnerCost() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ id, cost }: { id: string; cost: number }) => {
      const { error } = await supabase.rpc("set_partner_payable_cost", { p_id: id, p_unit_cost: cost });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}

/** Total por aliado de lo que está en la lista. */
export function totalsByPartner(rows: Pick<PartnerPayable, "location_id" | "amount" | "location">[]) {
  const m = new Map<string, { name: string; amount: number; missingCost: number }>();
  for (const r of rows) {
    const t = m.get(r.location_id) ?? { name: r.location?.name ?? "Aliado", amount: 0, missingCost: 0 };
    if (r.amount === null) t.missingCost += 1;
    else t.amount = Math.round((t.amount + r.amount) * 100) / 100;
    m.set(r.location_id, t);
  }
  return [...m.entries()].map(([id, t]) => ({ id, ...t })).sort((a, b) => a.name.localeCompare(b.name));
}
