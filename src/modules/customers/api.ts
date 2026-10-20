/** Ficha de clientes. Portado de sublime_customers (basicosystems@f551478b). */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";

/** Cliente de una venta: el elegido de la ficha (id) o los datos escritos al cobrar. */
export interface SaleCustomer {
  id?: string;
  name?: string;
  doc?: string;
  phone?: string;
}

export interface Customer {
  id: string;
  name: string;
  doc: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  created_at: string;
  purchases: number;
  total: number;
  last_purchase: string | null;
}

export interface CustomerSale {
  id: string;
  number: string;
  status: "completed" | "voided";
  sold_at: string;
  total: number;
  base_currency: string;
}

export type CustomerDraft = Pick<Customer, "name" | "doc" | "phone" | "email" | "address" | "notes">;

function useTenantKey() {
  const { active } = useTenant();
  return active?.tenant.id ?? "none";
}

function asError(error: { message?: string } | null): Error {
  return new Error(error?.message ?? "Error desconocido");
}

/** Búsqueda por nombre, cédula/RIF, teléfono o correo, con compras y total. */
export function useCustomers(query: string, limit = 200, enabled = true) {
  const tenant = useTenantKey();
  const q = query.trim();
  return useQuery({
    enabled,
    queryKey: ["customers", tenant, q, limit],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("customers_overview", { p_query: q || null, p_limit: limit });
      if (error) throw asError(error);
      return ((data ?? []) as Customer[]).map((c) => ({ ...c, purchases: Number(c.purchases), total: Number(c.total) }));
    },
    placeholderData: (prev) => prev,
  });
}

export function useCustomerSales(customerId: string | null) {
  const tenant = useTenantKey();
  return useQuery({
    enabled: Boolean(customerId),
    queryKey: ["customers", tenant, "sales", customerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("id, number, status, sold_at, total, base_currency")
        .eq("customer_id", customerId)
        .order("sold_at", { ascending: false })
        .limit(200);
      if (error) throw asError(error);
      return (data ?? []).map((s) => ({ ...s, total: Number(s.total) })) as CustomerSale[];
    },
  });
}

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

export function useSaveCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, draft }: { id: string | null; draft: CustomerDraft }) => {
      const row = {
        name: draft.name.trim(),
        doc: clean(draft.doc),
        phone: clean(draft.phone),
        email: clean(draft.email),
        address: clean(draft.address),
        notes: clean(draft.notes),
      };
      const req = id ? supabase.from("customers").update(row).eq("id", id) : supabase.from("customers").insert(row);
      const { error } = await req;
      if (error) {
        if (error.code === "23505") throw new Error("Ya hay un cliente con esa cédula o RIF.");
        throw asError(error);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customers"] }),
  });
}
