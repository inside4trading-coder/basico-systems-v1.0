/**
 * Cuentas por pagar y proveedores del negocio activo. Lectura por RLS; las
 * facturas y pagos cambian solo por RPC (supabase/migrations/20261222000000_payables.sql).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/core/supabase";
import { getActiveTenantId } from "@/core/tenant";
import { useTenant } from "@/core/tenant-context";

export interface Supplier {
  id: string;
  name: string;
  tax_id: string | null;
  phone: string | null;
  contact: string | null;
  credit_days: number;
  notes: string | null;
  is_active: boolean;
}

export interface PayableInstallment {
  id: string;
  payable_id: string;
  number: number;
  due_date: string;
  amount: number;
  paid: number;
}

export type PayableStatus = "open" | "paid" | "cancelled";

export interface Payable {
  id: string;
  supplier_id: string;
  supplier: { name: string; tax_id: string | null } | null;
  document: string | null;
  control_number: string | null;
  issued_on: string;
  currency: string;
  subtotal: number | null;
  tax_amount: number | null;
  amount: number;
  paid: number;
  category: string;
  status: PayableStatus;
  cancel_reason: string | null;
  note: string | null;
  source: "manual" | "reception";
  proof_paths: string[];
  installments: PayableInstallment[];
}

export interface PayablePayment {
  id: string;
  kind: "cash" | "credit_note";
  amount: number;
  occurred_on: string;
  movement_id: string | null;
  reference: string | null;
  note: string | null;
  voided_at: string | null;
  void_reason: string | null;
  movement: { amount: number; currency: string; account: { name: string } | null } | null;
}

export interface PayablesSummary {
  open: number;
  total: number;
  overdue_count: number;
  overdue_total: number;
  due_7_total: number;
  due_30_total: number;
  unconverted: number;
  aging: { current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number };
  suppliers: { supplier_id: string; name: string; total: number; overdue: number }[];
}

function useTenantKey() {
  const { active } = useTenant();
  return active?.tenant.id ?? "none";
}

function asError(error: { message?: string } | null): Error {
  return new Error(error?.message ?? "Error desconocido");
}

const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export function useSuppliers() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["fin", tenant, "suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, name, tax_id, phone, contact, credit_days, notes, is_active")
        .order("name");
      if (error) throw asError(error);
      return (data ?? []) as Supplier[];
    },
  });
}

export function useSaveSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<Supplier> & { name: string }) => {
      const { id, ...fields } = input;
      const clean = {
        ...fields,
        name: fields.name.trim(),
        tax_id: fields.tax_id?.trim() || null,
        phone: fields.phone?.trim() || null,
        contact: fields.contact?.trim() || null,
        notes: fields.notes?.trim() || null,
      };
      const { data, error } = id
        ? await supabase.from("suppliers").update(clean).eq("id", id).select("id").single()
        : await supabase.from("suppliers").insert(clean).select("id").single();
      if (error) throw new Error(error.code === "23505" ? "Ya hay un proveedor con ese nombre" : error.message);
      return data.id as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fin"] }),
  });
}

export function usePayables() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["fin", tenant, "payables"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payables")
        .select("*, supplier:suppliers(name, tax_id), installments:payable_installments(*)")
        .order("issued_on", { ascending: false })
        .limit(1000);
      if (error) throw asError(error);
      return (data ?? []).map((p) => ({
        ...p,
        subtotal: nn(p.subtotal),
        tax_amount: nn(p.tax_amount),
        amount: n(p.amount),
        paid: n(p.paid),
        installments: ((p.installments ?? []) as PayableInstallment[])
          .map((i) => ({ ...i, amount: n(i.amount), paid: n(i.paid) }))
          .sort((a, b) => a.number - b.number),
      })) as Payable[];
    },
  });
}

export function usePayablePayments(payableId: string | null) {
  const tenant = useTenantKey();
  return useQuery({
    enabled: Boolean(payableId),
    queryKey: ["fin", tenant, "payables", "payments", payableId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payable_payments")
        .select("id, kind, amount, occurred_on, movement_id, reference, note, voided_at, void_reason, movement:finance_movements(amount, currency, account:finance_accounts(name))")
        .eq("payable_id", payableId!)
        .order("occurred_on", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw asError(error);
      return (data ?? []).map((p) => {
        const m = p.movement as unknown as { amount: unknown; currency: string; account: { name: string } | null } | null;
        return { ...p, amount: n(p.amount), movement: m ? { ...m, amount: n(m.amount) } : null };
      }) as PayablePayment[];
    },
  });
}

export function usePayablesSummary(enabled = true) {
  const tenant = useTenantKey();
  return useQuery({
    enabled,
    queryKey: ["fin", tenant, "payables", "summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("payables_summary");
      if (error) throw asError(error);
      const s = data as PayablesSummary;
      return {
        ...s,
        total: n(s.total),
        overdue_total: n(s.overdue_total),
        due_7_total: n(s.due_7_total),
        due_30_total: n(s.due_30_total),
        aging: {
          current: n(s.aging.current),
          d1_30: n(s.aging.d1_30),
          d31_60: n(s.aging.d31_60),
          d61_90: n(s.aging.d61_90),
          d90_plus: n(s.aging.d90_plus),
        },
        suppliers: s.suppliers.map((x) => ({ ...x, total: n(x.total), overdue: n(x.overdue) })),
      } as PayablesSummary;
    },
  });
}

function useRpc<T extends Record<string, unknown>, R = unknown>(fn: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: T) => {
      const { data, error } = await supabase.rpc(fn, args);
      if (error) throw asError(error);
      return data as R;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fin"] }),
  });
}

export interface NewPayable {
  supplier_id: string;
  document: string | null;
  control_number: string | null;
  issued_on: string;
  currency: string;
  amount: number;
  tax_amount: number | null;
  category: string;
  note: string | null;
  /** Vacío: una sola cuota a los días de crédito del proveedor. */
  installments: { due_date: string; amount: number }[];
}

export const useCreatePayable = () => useRpc<{ p: NewPayable }, string>("create_payable");
export const usePayPayable = () =>
  useRpc<{
    p_payable_id: string;
    p_account_id: string;
    p_amount: number;
    p_occurred_on: string;
    p_applied: number | null;
    p_reference: string | null;
    p_note: string | null;
  }>("pay_payable");
export const useCreditPayable = () =>
  useRpc<{ p_payable_id: string; p_amount: number; p_occurred_on: string; p_reference: string | null; p_note: string | null }>("credit_payable");
export const useVoidPayablePayment = () => useRpc<{ p_payment_id: string; p_reason: string }>("void_payable_payment");
export const useCancelPayable = () => useRpc<{ p_payable_id: string; p_reason: string }>("cancel_payable");

const PROOFS_BUCKET = "finance-proofs";

/** Sube la factura o el comprobante a <negocio>/<cuenta por pagar>/ y lo registra. */
export function useAttachPayableProofs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ payableId, files }: { payableId: string; files: File[] }) => {
      const tenant = getActiveTenantId();
      if (!tenant || files.length === 0) return;
      const paths: string[] = [];
      for (const file of files) {
        const safe = file.name.normalize("NFD").replace(/[^\w.-]+/g, "_").slice(-80);
        const path = `${tenant}/${payableId}/${Date.now()}-${safe}`;
        const { error } = await supabase.storage.from(PROOFS_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
        if (error) throw new Error(`No se pudo subir ${file.name}: ${error.message}`);
        paths.push(path);
      }
      const { error } = await supabase.rpc("attach_payable_proofs", { p_payable_id: payableId, p_paths: paths });
      if (error) throw asError(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fin"] }),
  });
}
