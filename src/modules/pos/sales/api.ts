/**
 * Historial de ventas, anulación y devoluciones (RPC void_sale y
 * create_sale_return en 20261031000000_sale_void_returns.sql).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";

export interface SaleRow {
  id: string;
  number: string;
  status: "completed" | "voided";
  session_id: string;
  sold_at: string;
  total: number;
  base_currency: string;
  customer_name: string | null;
  void_reason: string | null;
  /** Factura emitida aparte (máquina fiscal o imprenta digital), si se anotó. */
  invoice_number: string | null;
}

export interface SaleDetailItem {
  id: string;
  line: number;
  description: string;
  sku: string | null;
  qty: number;
  line_total: number;
  returned: number;
}

export interface SaleReturnRow {
  id: string;
  number: string;
  reason: string;
  total: number;
  restock: boolean;
  refund_method_name: string | null;
  refund_currency: string | null;
  refund_amount: number | null;
  created_at: string;
  items: { description: string; qty: number; amount: number }[];
}

export interface SaleDetail extends SaleRow {
  items: SaleDetailItem[];
  payments: { method_name: string; currency: string; amount: number }[];
  returns: SaleReturnRow[];
}

function useTenantKey() {
  const { active } = useTenant();
  return active?.tenant.id ?? "none";
}

const n = (v: unknown) => Number(v ?? 0);
const SALE_COLUMNS = "id, number, status, session_id, sold_at, total, base_currency, customer_name, void_reason, invoice_number";

/** Ventas de la caja o, con texto, búsqueda por número o cliente en todas. */
export function useSales(sessionId: string, query: string) {
  const tenant = useTenantKey();
  const q = query.trim();
  return useQuery({
    queryKey: ["pos", tenant, "sales", sessionId, q],
    queryFn: async () => {
      let req = supabase.from("sales").select(SALE_COLUMNS).order("sold_at", { ascending: false }).limit(100);
      if (q) {
        const safe = q.replace(/[%,()]/g, " ");
        req = req.or(`number.ilike.%${safe}%,customer_name.ilike.%${safe}%,invoice_number.ilike.%${safe}%`);
      } else {
        req = req.eq("session_id", sessionId);
      }
      const { data, error } = await req;
      if (error) throw new Error(error.message);
      return (data ?? []).map((s) => ({ ...s, total: n(s.total) })) as SaleRow[];
    },
  });
}

export function useSaleDetail(saleId: string | null) {
  const tenant = useTenantKey();
  return useQuery({
    enabled: Boolean(saleId),
    queryKey: ["pos", tenant, "sale", saleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select(
          `${SALE_COLUMNS}, sale_items(id, line, description, sku, qty, line_total), sale_payments(method_name, currency, amount),
           sale_returns(id, number, reason, total, restock, refund_method_name, refund_currency, refund_amount, created_at,
                        sale_return_items(sale_item_id, description, qty, amount))`,
        )
        .eq("id", saleId)
        .single();
      if (error) throw new Error(error.message);
      const row = data as Record<string, unknown> & {
        sale_items: Record<string, unknown>[];
        sale_payments: Record<string, unknown>[];
        sale_returns: (Record<string, unknown> & { sale_return_items: Record<string, unknown>[] })[];
      };
      const returnedBy = new Map<string, number>();
      for (const r of row.sale_returns) for (const i of r.sale_return_items) returnedBy.set(String(i.sale_item_id), (returnedBy.get(String(i.sale_item_id)) ?? 0) + n(i.qty));
      return {
        ...(row as unknown as SaleRow),
        total: n(row.total),
        items: row.sale_items
          .map((i) => ({
            id: String(i.id),
            line: n(i.line),
            description: String(i.description),
            sku: (i.sku as string | null) ?? null,
            qty: n(i.qty),
            line_total: n(i.line_total),
            returned: returnedBy.get(String(i.id)) ?? 0,
          }))
          .sort((a, b) => a.line - b.line),
        payments: row.sale_payments.map((p) => ({ method_name: String(p.method_name), currency: String(p.currency), amount: n(p.amount) })),
        returns: row.sale_returns
          .map((r) => ({
            id: String(r.id),
            number: String(r.number),
            reason: String(r.reason),
            total: n(r.total),
            restock: Boolean(r.restock),
            refund_method_name: (r.refund_method_name as string | null) ?? null,
            refund_currency: (r.refund_currency as string | null) ?? null,
            refund_amount: r.refund_amount === null ? null : n(r.refund_amount),
            created_at: String(r.created_at),
            items: r.sale_return_items.map((i) => ({ description: String(i.description), qty: n(i.qty), amount: n(i.amount) })),
          }))
          .sort((a, b) => a.created_at.localeCompare(b.created_at)),
      } as SaleDetail;
    },
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["pos"] });
    void qc.invalidateQueries({ queryKey: ["fin"] });
    void qc.invalidateQueries({ queryKey: ["inv"] });
  };
}

export function useSetInvoice() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: { saleId: string; number: string }) => {
      const { error } = await supabase.rpc("set_sale_invoice", { p_sale_id: input.saleId, p_number: input.number });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}

export function useVoidSale() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: { saleId: string; reason: string }) => {
      const { error } = await supabase.rpc("void_sale", { p_sale_id: input.saleId, p_reason: input.reason });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
  });
}

export function useCreateReturn() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: {
      saleId: string;
      items: { sale_item_id: string; qty: number }[];
      reason: string;
      restock: boolean;
      refundMethodId: string | null;
      sessionId: string | null;
    }) => {
      const { data, error } = await supabase.rpc("create_sale_return", {
        p_sale_id: input.saleId,
        p_items: input.items,
        p_reason: input.reason,
        p_restock: input.restock,
        p_refund_method_id: input.refundMethodId,
        p_session_id: input.sessionId,
      });
      if (error) throw new Error(error.message);
      return data as { number: string; total: number; refund_amount: number | null; refund_currency: string | null };
    },
    onSuccess: invalidate,
  });
}
