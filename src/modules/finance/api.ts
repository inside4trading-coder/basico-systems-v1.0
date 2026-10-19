/**
 * Administración del negocio activo: cuentas, libro de movimientos y
 * obligaciones. El libro se escribe solo por RPC (supabase/migrations/
 * 20261026000000_finance.sql); cuentas y obligaciones, directo con RLS.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";
import { getActiveTenantId } from "@/core/tenant";
import type { AccountKind, Frequency, Importance, InstanceStatus, MovementKind, ObligationStatus } from "./lib";

export interface FinanceAccount {
  id: string;
  name: string;
  kind: AccountKind;
  currency: string;
  institution: string | null;
  number_hint: string | null;
  opening_balance: number;
  opening_date: string;
  is_active: boolean;
  position: number;
}

export interface FinanceMovement {
  id: string;
  account_id: string;
  direction: "in" | "out";
  kind: MovementKind;
  amount: number;
  currency: string;
  occurred_on: string;
  category: string | null;
  counterparty: string | null;
  reference: string | null;
  note: string | null;
  transfer_id: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
  obligation_instance_id: string | null;
  obligation_amount: number | null;
}

export interface Obligation {
  id: string;
  name: string;
  category: string | null;
  counterparty: string | null;
  amount: number | null;
  currency: string;
  frequency: Frequency;
  start_date: string;
  end_date: string | null;
  account_id: string | null;
  status: ObligationStatus;
  importance: Importance;
  responsible: string | null;
  payment_method: string | null;
  is_fixed_expense: boolean;
  notes: string | null;
}

export interface ObligationInstance {
  id: string;
  obligation_id: string;
  due_date: string;
  amount: number | null;
  currency: string;
  status: InstanceStatus;
  paid_on: string | null;
  movement_id: string | null;
  note: string | null;
  paid_amount: number;
  settled: boolean;
  custom: boolean;
  proof_paths: string[];
  void_reason: string | null;
}

export interface ObligationEvent {
  id: string;
  obligation_id: string;
  instance_id: string | null;
  action: string;
  detail: Record<string, unknown>;
  actor: string | null;
  created_at: string;
}

export interface FinanceSummary {
  accounts: { id: string; name: string; kind: AccountKind; currency: string; is_active: boolean; balance: number; last_movement_on: string | null }[];
  overdue: { count: number; by_currency: Record<string, number> };
  upcoming: { id: string; obligation_id: string; name: string; due_date: string; amount: number | null; currency: string; importance: Importance; status: InstanceStatus }[];
}

function useTenantKey() {
  const { active } = useTenant();
  return active?.tenant.id ?? "none";
}

function asError(error: { message?: string } | null): Error {
  return new Error(error?.message ?? "Error desconocido");
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function useInvalidateFinance() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["fin"] });
}

export function useFinanceSummary() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["fin", tenant, "summary"],
    queryFn: async () => {
      // Las cuotas se generan en el servidor; al abrir se completan las que falten.
      const refresh = await supabase.rpc("refresh_obligations");
      if (refresh.error) throw asError(refresh.error);
      const { data, error } = await supabase.rpc("finance_summary");
      if (error) throw asError(error);
      const s = data as FinanceSummary;
      return {
        ...s,
        accounts: s.accounts.map((a) => ({ ...a, balance: Number(a.balance) })),
        upcoming: s.upcoming.map((u) => ({ ...u, amount: num(u.amount) })),
      } as FinanceSummary;
    },
  });
}

export function useAccounts() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["fin", tenant, "accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("finance_accounts").select("*").order("position").order("name");
      if (error) throw asError(error);
      return (data ?? []).map((a) => ({ ...a, opening_balance: Number(a.opening_balance) })) as FinanceAccount[];
    },
  });
}

export function useSaveAccount() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: Partial<FinanceAccount> & { id?: string }) => {
      const { id, ...fields } = input;
      const { error } = id
        ? await supabase.from("finance_accounts").update(withoutCurrency(fields)).eq("id", id)
        : await supabase.from("finance_accounts").insert(fields);
      if (error) throw asError(error);
    },
    onSuccess: invalidate,
  });
}

/** La moneda no se puede cambiar después de crear la cuenta. */
function withoutCurrency<T extends { currency?: string }>(fields: T): Omit<T, "currency"> {
  const { currency: _currency, ...rest } = fields;
  return rest;
}

export interface MovementFilters {
  accountId: string | null;
  from: string;
  to: string;
}

export function useMovements(filters: MovementFilters) {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["fin", tenant, "movements", filters],
    queryFn: async () => {
      let q = supabase
        .from("finance_movements")
        .select("*")
        .gte("occurred_on", filters.from)
        .lte("occurred_on", filters.to)
        .order("occurred_on", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1000);
      if (filters.accountId) q = q.eq("account_id", filters.accountId);
      const { data, error } = await q;
      if (error) throw asError(error);
      return (data ?? []).map((m) => ({ ...m, amount: Number(m.amount), obligation_amount: num(m.obligation_amount) })) as FinanceMovement[];
    },
  });
}

export function useCreateMovement() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: {
      accountId: string;
      direction: "in" | "out";
      amount: number;
      occurredOn: string;
      category?: string;
      counterparty?: string;
      reference?: string;
      note?: string;
    }) => {
      const { error } = await supabase.rpc("finance_movement", {
        p_account_id: input.accountId,
        p_direction: input.direction,
        p_amount: input.amount,
        p_occurred_on: input.occurredOn,
        p_category: input.category ?? null,
        p_counterparty: input.counterparty ?? null,
        p_reference: input.reference ?? null,
        p_note: input.note ?? null,
      });
      if (error) throw asError(error);
    },
    onSuccess: invalidate,
  });
}

export function useTransfer() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: { fromId: string; toId: string; amountOut: number; amountIn: number | null; occurredOn: string; note?: string }) => {
      const { error } = await supabase.rpc("finance_transfer", {
        p_from_account: input.fromId,
        p_to_account: input.toId,
        p_amount_out: input.amountOut,
        p_amount_in: input.amountIn,
        p_occurred_on: input.occurredOn,
        p_note: input.note ?? null,
      });
      if (error) throw asError(error);
    },
    onSuccess: invalidate,
  });
}

export function useVoidMovement() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("void_finance_movement", { p_movement_id: id, p_reason: reason });
      if (error) throw asError(error);
    },
    onSuccess: invalidate,
  });
}

export function useObligations() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["fin", tenant, "obligations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("obligations").select("*").order("status").order("name");
      if (error) throw asError(error);
      return (data ?? []).map((o) => ({ ...o, amount: num(o.amount) })) as Obligation[];
    },
  });
}

export function useSaveObligation() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: Partial<Obligation> & { id?: string }) => {
      const { id, ...fields } = input;
      const { error } = id ? await supabase.from("obligations").update(fields).eq("id", id) : await supabase.from("obligations").insert(fields);
      if (error) throw asError(error);
      const refresh = await supabase.rpc("refresh_obligations");
      if (refresh.error) throw asError(refresh.error);
    },
    onSuccess: invalidate,
  });
}

const mapInstance = (i: Record<string, unknown>) =>
  ({ ...i, amount: num(i.amount), paid_amount: Number(i.paid_amount ?? 0), proof_paths: (i.proof_paths as string[] | null) ?? [] }) as ObligationInstance;

/**
 * Cuotas de un rango (el mes del calendario) más todas las abiertas, para
 * vencidas y alertas. Antes se generan las que falten hasta el fin del rango.
 */
export function useInstances(from: string, to: string) {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["fin", tenant, "instances", from, to],
    queryFn: async () => {
      const refresh = await supabase.rpc("refresh_obligations", { p_until: to });
      if (refresh.error) throw asError(refresh.error);
      const { data, error } = await supabase
        .from("obligation_instances")
        .select("*")
        .or(`and(due_date.gte.${from},due_date.lte.${to}),status.in.(pending,partial)`)
        .order("due_date")
        .limit(2000);
      if (error) throw asError(error);
      return (data ?? []).map(mapInstance);
    },
  });
}

export function useObligation(id: string | undefined) {
  const tenant = useTenantKey();
  return useQuery({
    enabled: Boolean(id),
    queryKey: ["fin", tenant, "obligation", id],
    queryFn: async () => {
      const [o, inst, events] = await Promise.all([
        supabase.from("obligations").select("*").eq("id", id!).maybeSingle(),
        supabase.from("obligation_instances").select("*").eq("obligation_id", id!).order("due_date", { ascending: false }).limit(500),
        supabase.from("obligation_events").select("*").eq("obligation_id", id!).order("created_at", { ascending: false }).limit(300),
      ]);
      if (o.error) throw asError(o.error);
      if (inst.error) throw asError(inst.error);
      if (events.error) throw asError(events.error);
      return {
        obligation: o.data ? ({ ...o.data, amount: num(o.data.amount) } as Obligation) : null,
        instances: (inst.data ?? []).map(mapInstance),
        events: (events.data ?? []) as ObligationEvent[],
      };
    },
  });
}

/** Pagos (salidas del libro) de una cuota. */
export function useInstancePayments(instanceId: string | null) {
  const tenant = useTenantKey();
  return useQuery({
    enabled: Boolean(instanceId),
    queryKey: ["fin", tenant, "instance_payments", instanceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("finance_movements")
        .select("*")
        .eq("obligation_instance_id", instanceId!)
        .order("occurred_on", { ascending: false });
      if (error) throw asError(error);
      return (data ?? []).map((m) => ({ ...m, amount: Number(m.amount), obligation_amount: num(m.obligation_amount) })) as FinanceMovement[];
    },
  });
}

const PROOFS_BUCKET = "finance-proofs";

/** Sube comprobantes a <negocio>/<cuota>/ y los registra en la cuota. */
export async function uploadProofs(instanceId: string, files: File[]): Promise<void> {
  const tenant = getActiveTenantId();
  if (!tenant || files.length === 0) return;
  const paths: string[] = [];
  for (const file of files) {
    const safe = file.name.normalize("NFD").replace(/[^\w.-]+/g, "_").slice(-80);
    const path = `${tenant}/${instanceId}/${Date.now()}-${safe}`;
    const { error } = await supabase.storage.from(PROOFS_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw new Error(`No se pudo subir ${file.name}: ${error.message}`);
    paths.push(path);
  }
  const { error } = await supabase.rpc("attach_obligation_proofs", { p_instance_id: instanceId, p_paths: paths });
  if (error) throw asError(error);
}

export async function proofUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(PROOFS_BUCKET).createSignedUrl(path, 600);
  if (error || !data) throw asError(error);
  return data.signedUrl;
}

export function useAttachProofs() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: ({ instanceId, files }: { instanceId: string; files: File[] }) => uploadProofs(instanceId, files),
    onSuccess: invalidate,
  });
}

export function useVoidInstance() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async ({ instanceId, reason }: { instanceId: string; reason: string }) => {
      const { error } = await supabase.rpc("void_obligation_instance", { p_instance_id: instanceId, p_reason: reason });
      if (error) throw asError(error);
    },
    onSuccess: invalidate,
  });
}

export function useReopenInstance() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (instanceId: string) => {
      const { error } = await supabase.rpc("reopen_obligation_instance", { p_instance_id: instanceId });
      if (error) throw asError(error);
    },
    onSuccess: invalidate,
  });
}

export function useUpdateInstance() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: { instanceId: string; amount: number | null; dueDate: string; note?: string }) => {
      const { error } = await supabase.rpc("update_obligation_instance", {
        p_instance_id: input.instanceId,
        p_amount: input.amount,
        p_due_date: input.dueDate,
        p_note: input.note ?? null,
      });
      if (error) throw asError(error);
    },
    onSuccess: invalidate,
  });
}

export function useAddInstance() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: { obligationId: string; dueDate: string; amount: number | null; note?: string }) => {
      const { error } = await supabase.rpc("add_obligation_instance", {
        p_obligation_id: input.obligationId,
        p_due_date: input.dueDate,
        p_amount: input.amount,
        p_note: input.note ?? null,
      });
      if (error) throw asError(error);
    },
    onSuccess: invalidate,
  });
}

export function usePayInstance() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: {
      instanceId: string;
      accountId: string;
      amount: number;
      paidOn: string;
      reference?: string;
      note?: string;
      /** Cuánto cubre en la moneda de la cuota, si la cuenta está en otra. */
      applied?: number | null;
      /** Darla por pagada aunque no alcance. */
      settle?: boolean;
      files?: File[];
    }) => {
      const { error } = await supabase.rpc("pay_obligation", {
        p_instance_id: input.instanceId,
        p_account_id: input.accountId,
        p_amount: input.amount,
        p_paid_on: input.paidOn,
        p_reference: input.reference ?? null,
        p_note: input.note ?? null,
        p_applied: input.applied ?? null,
        p_settle: input.settle ?? false,
      });
      if (error) throw asError(error);
      // El pago ya quedó; si falla un comprobante se avisa, pero el pago no se pierde.
      if (input.files?.length) await uploadProofs(input.instanceId, input.files);
    },
    onSuccess: invalidate,
  });
}

export function useSkipInstance() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async ({ instanceId, note }: { instanceId: string; note: string }) => {
      const { error } = await supabase.rpc("skip_obligation", { p_instance_id: instanceId, p_note: note });
      if (error) throw asError(error);
    },
    onSuccess: invalidate,
  });
}
