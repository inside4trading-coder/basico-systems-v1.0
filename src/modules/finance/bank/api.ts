/**
 * Conciliación bancaria del negocio activo. Perfiles por RLS; cargas, líneas
 * y vínculos solo por RPC (supabase/migrations/20261029000000_bank_reconciliation.sql).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";
import type { FinanceMovement } from "../api";
import type { BankProfileSpec, BankRow, BankRowError } from "./parse";

export interface BankProfile extends BankProfileSpec {
  id: string;
  account_id: string;
  name: string;
  sheet_name: string | null;
  is_active: boolean;
}

export type LineStatus = "unmatched" | "possible" | "matched" | "ignored";

export interface BankLine {
  id: string;
  account_id: string;
  batch_id: string;
  row_number: number | null;
  line_date: string;
  line_time: string | null;
  direction: "in" | "out";
  amount: number;
  currency: string;
  reference: string | null;
  operation_number: string | null;
  description: string | null;
  balance: number | null;
  status: LineStatus;
  movement_id: string | null;
  match_kind: "auto" | "manual" | "created" | null;
  ignore_reason: string | null;
}

export interface BankBatch {
  id: string;
  account_id: string;
  profile_id: string | null;
  file_name: string;
  rows_read: number;
  rows_new: number;
  rows_duplicate: number;
  rows_error: number;
  issues: BankRowError[];
  created_at: string;
}

export interface ImportResult {
  batch_id: string;
  inserted: number;
  duplicates: number;
  errors: number;
  auto_matched: number;
  /** Comisiones registradas solas por las frases de la cuenta. */
  fees?: number;
  possible: number;
  unmatched: number;
}

function useTenantKey() {
  const { active } = useTenant();
  return active?.tenant.id ?? "none";
}

function asError(error: { message?: string } | null): Error {
  return new Error(error?.message ?? "Error desconocido");
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["fin"] });
}

export function useBankProfiles() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["fin", tenant, "bank", "profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("bank_import_profiles").select("*").order("name");
      if (error) throw asError(error);
      return (data ?? []) as BankProfile[];
    },
  });
}

export function useSaveBankProfile() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: Partial<BankProfile> & { id?: string }) => {
      const { id, account_id, ...fields } = input;
      const { data, error } = id
        ? await supabase.from("bank_import_profiles").update(fields).eq("id", id).select("id").single()
        : await supabase.from("bank_import_profiles").insert({ ...fields, account_id }).select("id").single();
      if (error) throw new Error(error.code === "23505" ? "Ya hay un perfil con ese nombre en la cuenta" : (error.message ?? "Error desconocido"));
      return (data as { id: string }).id;
    },
    onSuccess: invalidate,
  });
}

export function useBankLines(accountId: string | null) {
  const tenant = useTenantKey();
  return useQuery({
    enabled: Boolean(accountId),
    queryKey: ["fin", tenant, "bank", "lines", accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bank_statement_lines")
        .select(
          "id, account_id, batch_id, row_number, line_date, line_time, direction, amount, currency, reference, operation_number, description, balance, status, movement_id, match_kind, ignore_reason",
        )
        .eq("account_id", accountId)
        .order("line_date", { ascending: false })
        .order("row_number", { ascending: true })
        .limit(2000);
      if (error) throw asError(error);
      return (data ?? []).map((l) => ({ ...l, amount: Number(l.amount), balance: l.balance === null ? null : Number(l.balance) })) as BankLine[];
    },
  });
}

export function useBankBatches(accountId: string | null) {
  const tenant = useTenantKey();
  return useQuery({
    enabled: Boolean(accountId),
    queryKey: ["fin", tenant, "bank", "batches", accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bank_import_batches")
        .select("id, account_id, profile_id, file_name, rows_read, rows_new, rows_duplicate, rows_error, issues, created_at")
        .eq("account_id", accountId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw asError(error);
      return (data ?? []) as BankBatch[];
    },
  });
}

export function useBankPending() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["fin", tenant, "bank", "pending"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("bank_pending");
      if (error) throw asError(error);
      const p = data as { unmatched: number; possible: number; last_import: string | null };
      return { unmatched: Number(p.unmatched), possible: Number(p.possible), last_import: p.last_import };
    },
  });
}

/** Movimientos del libro que podrían ser la línea: misma cuenta y dirección, ±15 días, sin conciliar. */
export function useLineCandidates(line: BankLine | null) {
  const tenant = useTenantKey();
  return useQuery({
    enabled: Boolean(line),
    queryKey: ["fin", tenant, "bank", "candidates", line?.id],
    queryFn: async () => {
      if (!line) return [];
      const shift = (days: number) => {
        const d = new Date(`${line.line_date}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() + days);
        return d.toISOString().slice(0, 10);
      };
      const { data, error } = await supabase
        .from("finance_movements")
        .select("*")
        .eq("account_id", line.account_id)
        .eq("direction", line.direction)
        .is("voided_at", null)
        .gte("occurred_on", shift(-15))
        .lte("occurred_on", shift(15))
        .limit(300);
      if (error) throw asError(error);
      const movements = (data ?? []).map((m) => ({ ...m, amount: Number(m.amount) })) as FinanceMovement[];
      if (movements.length === 0) return [];
      const linked = await supabase.from("bank_statement_lines").select("movement_id").in("movement_id", movements.map((m) => m.id));
      if (linked.error) throw asError(linked.error);
      const taken = new Set((linked.data ?? []).map((l) => l.movement_id));
      return movements.filter((m) => !taken.has(m.id));
    },
  });
}

export function useLinkedMovement(movementId: string | null) {
  const tenant = useTenantKey();
  return useQuery({
    enabled: Boolean(movementId),
    queryKey: ["fin", tenant, "bank", "linked", movementId],
    queryFn: async () => {
      const { data, error } = await supabase.from("finance_movements").select("*").eq("id", movementId).maybeSingle();
      if (error) throw asError(error);
      return data ? ({ ...data, amount: Number(data.amount) } as FinanceMovement) : null;
    },
  });
}

export function useImportStatement() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: { accountId: string; profileId: string; fileName: string; fileHash: string; rows: BankRow[]; issues: BankRowError[] }) => {
      const { data, error } = await supabase.rpc("import_bank_statement", {
        p_account_id: input.accountId,
        p_profile_id: input.profileId,
        p_file_name: input.fileName,
        p_file_hash: input.fileHash,
        p_rows: input.rows,
        p_issues: input.issues,
      });
      if (error) throw asError(error);
      return data as ImportResult;
    },
    onSuccess: invalidate,
  });
}

function useLineRpc<T extends Record<string, unknown>>(fn: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (args: T) => {
      const { data, error } = await supabase.rpc(fn, args);
      if (error) throw asError(error);
      return data as unknown;
    },
    onSuccess: invalidate,
  });
}

export const useAutoreconcile = () => useLineRpc<{ p_account_id: string; p_days?: number }>("bank_autoreconcile");
export const useMatchLine = () => useLineRpc<{ p_line_id: string; p_movement_id: string }>("match_bank_line");
export const useCreateFromLine = () =>
  useLineRpc<{ p_line_id: string; p_category: string | null; p_counterparty: string | null; p_note: string | null }>("create_movement_from_bank_line");
export const useIgnoreLine = () => useLineRpc<{ p_line_id: string; p_reason: string }>("ignore_bank_line");
export const useReopenLine = () => useLineRpc<{ p_line_id: string }>("reopen_bank_line");

export interface FeeRule {
  id: string;
  account_id: string;
  phrase: string;
  match: "starts" | "contains";
  fee_type: string;
  is_active: boolean;
}

export interface FeeMatch {
  line_id: string;
  date: string;
  amount: number;
  description: string | null;
  fee_type: string;
  phrase: string;
}

export function useFeeRules(accountId: string | null) {
  const tenant = useTenantKey();
  return useQuery({
    enabled: Boolean(accountId),
    queryKey: ["fin", tenant, "bank", "fee_rules", accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bank_fee_rules")
        .select("id, account_id, phrase, match, fee_type, is_active")
        .eq("account_id", accountId)
        .order("created_at");
      if (error) throw asError(error);
      return (data ?? []) as FeeRule[];
    },
  });
}

export function useSaveFeeRule() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: Partial<FeeRule> & { account_id: string; id?: string }) => {
      const { id, account_id, ...fields } = input;
      const { error } = id
        ? await supabase.from("bank_fee_rules").update(fields).eq("id", id)
        : await supabase.from("bank_fee_rules").insert({ ...fields, account_id });
      if (error) throw new Error(error.code === "23505" ? "Esa frase ya está en la cuenta" : (error.message ?? "Error desconocido"));
    },
    onSuccess: invalidate,
  });
}

export function useDeleteFeeRule() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("bank_fee_rules").delete().eq("id", id);
      if (error) throw asError(error);
    },
    onSuccess: invalidate,
  });
}

/** Qué salidas abiertas coinciden con las frases (sin registrar nada). */
export function useFeeMatches(accountId: string | null, rulesKey: string) {
  const tenant = useTenantKey();
  return useQuery({
    enabled: Boolean(accountId),
    queryKey: ["fin", tenant, "bank", "fee_matches", accountId, rulesKey],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("apply_bank_fee_rules", { p_account_id: accountId, p_apply: false });
      if (error) throw asError(error);
      return ((data as { items: FeeMatch[] }).items ?? []).map((i) => ({ ...i, amount: Number(i.amount) }));
    },
  });
}

export const useApplyFees = () => useLineRpc<{ p_account_id: string; p_apply: boolean }>("apply_bank_fee_rules");

export interface ReceivableCandidate {
  receivable_id: string;
  kind: "credit" | "financing";
  provider: string | null;
  customer_name: string | null;
  document: string | null;
  external_ref: string | null;
  currency: string;
  pending: number;
  next_number: number | null;
  next_due: string | null;
  next_pending: number | null;
  /** Lo que cubre la línea en la moneda de la cuenta por cobrar (null si no hay tasa). */
  applied: number | null;
  match: "installment" | "balance" | null;
}

/** Cuentas por cobrar abiertas que podría estar pagando una entrada del banco. */
export function useReceivableCandidates(line: BankLine | null) {
  const tenant = useTenantKey();
  return useQuery({
    enabled: Boolean(line && line.direction === "in"),
    queryKey: ["fin", tenant, "bank", "receivable-candidates", line?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("bank_receivable_candidates", { p_line_id: line!.id });
      if (error) throw asError(error);
      const res = data as { rate: number | null; items: ReceivableCandidate[] };
      const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
      return {
        rate: num(res.rate),
        items: res.items.map((c) => ({
          ...c,
          pending: Number(c.pending),
          next_pending: num(c.next_pending),
          applied: num(c.applied),
        })),
      };
    },
  });
}

export const useCollectFromLine = () =>
  useLineRpc<{ p_line_id: string; p_receivable_id: string; p_applied?: number | null; p_payer?: "customer" | "provider" }>(
    "collect_receivable_from_bank_line",
  );
export const useSettleFromLine = () => useLineRpc<{ p_line_id: string; p_provider: string }>("settle_provider_from_bank_line");
