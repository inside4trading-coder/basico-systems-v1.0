/**
 * Cuentas por cobrar del negocio activo. Lectura por RLS; todo cambio por RPC
 * (supabase/migrations/20261030000000_receivables.sql).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";
import type { FinancingRow } from "./financingFile";

export interface ReceivableInstallment {
  id: string;
  receivable_id: string;
  number: number;
  due_date: string;
  amount: number;
  collected: number;
  covered: number;
  provider_status: string | null;
}

export interface Receivable {
  id: string;
  kind: "credit" | "financing";
  provider: string | null;
  customer_name: string | null;
  customer_doc: string | null;
  document: string | null;
  external_ref: string | null;
  sale_id: string | null;
  issued_on: string;
  currency: string;
  sale_total: number | null;
  initial_amount: number;
  amount: number;
  collected: number;
  commission_rate: number;
  status: "open" | "paid" | "cancelled";
  cancel_reason: string | null;
  note: string | null;
  installments: ReceivableInstallment[];
}

export interface ReceivableCollection {
  id: string;
  kind: "cash" | "provider_credit" | "commission";
  payer: "customer" | "provider";
  installment_id: string | null;
  amount: number;
  occurred_on: string;
  movement_id: string | null;
  reference: string | null;
  note: string | null;
  voided_at: string | null;
  void_reason: string | null;
}

export interface ProviderEntry {
  id: string;
  provider: string;
  entry_date: string;
  kind: "coverage" | "service_invoice" | "settlement" | "adjustment";
  amount: number;
  currency: string;
  document: string | null;
  note: string | null;
  voided_at: string | null;
  void_reason: string | null;
}

export interface ReceivablesSummary {
  open: number;
  total: number;
  overdue_count: number;
  overdue_total: number;
  credit_total: number;
  financing_total: number;
  providers: { provider: string; currency: string; balance: number }[];
}

function useTenantKey() {
  const { active } = useTenant();
  return active?.tenant.id ?? "none";
}

function asError(error: { message?: string } | null): Error {
  return new Error(error?.message ?? "Error desconocido");
}

const n = (v: unknown) => Number(v ?? 0);

export function useReceivables() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["fin", tenant, "receivables"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("receivables")
        .select("*, installments:receivable_installments(*)")
        .order("issued_on", { ascending: false })
        .limit(1000);
      if (error) throw asError(error);
      return (data ?? []).map((r) => ({
        ...r,
        sale_total: r.sale_total === null ? null : n(r.sale_total),
        initial_amount: n(r.initial_amount),
        amount: n(r.amount),
        collected: n(r.collected),
        commission_rate: n(r.commission_rate),
        installments: ((r.installments ?? []) as ReceivableInstallment[])
          .map((i) => ({ ...i, amount: n(i.amount), collected: n(i.collected), covered: n(i.covered) }))
          .sort((a, b) => a.number - b.number),
      })) as Receivable[];
    },
  });
}

export function useReceivableCollections(receivableId: string | null) {
  const tenant = useTenantKey();
  return useQuery({
    enabled: Boolean(receivableId),
    queryKey: ["fin", tenant, "receivables", "collections", receivableId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("receivable_collections")
        .select("id, kind, payer, installment_id, amount, occurred_on, movement_id, reference, note, voided_at, void_reason")
        .eq("receivable_id", receivableId)
        .order("occurred_on", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw asError(error);
      return (data ?? []).map((c) => ({ ...c, amount: n(c.amount) })) as ReceivableCollection[];
    },
  });
}

export function useProviderLedger() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["fin", tenant, "receivables", "ledger"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_ledger")
        .select("id, provider, entry_date, kind, amount, currency, document, note, voided_at, void_reason")
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw asError(error);
      return (data ?? []).map((e) => ({ ...e, amount: n(e.amount) })) as ProviderEntry[];
    },
  });
}

export function useReceivablesSummary() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["fin", tenant, "receivables", "summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("receivables_summary");
      if (error) throw asError(error);
      const s = data as ReceivablesSummary;
      return {
        ...s,
        total: n(s.total),
        overdue_total: n(s.overdue_total),
        credit_total: n(s.credit_total),
        financing_total: n(s.financing_total),
        providers: s.providers.map((p) => ({ ...p, balance: n(p.balance) })),
      } as ReceivablesSummary;
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

export interface NewReceivable {
  provider?: string | null;
  customer_name?: string | null;
  customer_doc?: string | null;
  document?: string | null;
  external_ref?: string | null;
  issued_on: string;
  currency: string;
  amount: number;
  note?: string | null;
  installments: { due_date: string; amount: number }[];
}

export const useCreateReceivable = () => useRpc<{ p: NewReceivable }, string>("create_receivable");
export const useCollectReceivable = () =>
  useRpc<{
    p_receivable_id: string;
    p_account_id: string;
    p_amount: number;
    p_occurred_on: string;
    p_payer: "customer" | "provider";
    p_applied: number | null;
    p_reference: string | null;
    p_note: string | null;
  }>("collect_receivable");
export const useCoverInstallment = () =>
  useRpc<{ p_installment_id: string; p_amount: number; p_occurred_on: string; p_document: string | null }>("cover_installment");
export const useRegisterCommission = () =>
  useRpc<{ p_receivable_id: string; p_amount: number; p_occurred_on: string; p_note: string | null }>("register_receivable_commission");
export const useVoidCollection = () => useRpc<{ p_collection_id: string; p_reason: string }>("void_receivable_collection");
export const useCancelReceivable = () => useRpc<{ p_receivable_id: string; p_reason: string }>("cancel_receivable");
export const useAddProviderEntry = () =>
  useRpc<{
    p_provider: string;
    p_kind: "service_invoice" | "adjustment";
    p_amount: number;
    p_entry_date: string;
    p_currency: string;
    p_document: string | null;
    p_note: string | null;
  }>("add_provider_entry");
export const useSettleProvider = () =>
  useRpc<{ p_provider: string; p_account_id: string; p_direction: "in" | "out"; p_amount: number; p_entry_date: string; p_reference: string | null }>(
    "settle_provider",
  );
export const useVoidProviderEntry = () => useRpc<{ p_entry_id: string; p_reason: string }>("void_provider_entry");
export const useImportFinancing = () =>
  useRpc<
    { p_provider: string; p_file_name: string; p_file_hash: string; p_rows: (FinancingRow & { currency?: string })[] },
    { rows: number; created: number; updated: number; linked: number; issues: { row: number; reason: string }[] }
  >("import_financing");
