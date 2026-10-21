/**
 * Administración del negocio activo: cuentas, libro de movimientos y
 * obligaciones. El libro se escribe solo por RPC (supabase/migrations/
 * 20261026000000_finance.sql); cuentas y obligaciones, directo con RLS.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

export interface TreasuryAccount {
  id: string;
  name: string;
  kind: AccountKind;
  currency: string;
  is_active: boolean;
  balance: number;
  /** null: moneda sin conversión a la base (sin tasa u otra moneda). */
  balance_base: number | null;
  period_in: number;
  period_out: number;
  last_movement_on: string | null;
}

export interface CategoryTotal {
  category: string;
  amount: number;
}

export interface TreasurySummary {
  base_currency: string;
  local_currency: string | null;
  from: string | null;
  to: string;
  rate: { rate: number; effective_date: string; source: string } | null;
  accounts: TreasuryAccount[];
  liquidity: { total: number; available: number; unconverted: string[] };
  period: {
    income: number;
    expense: number;
    unconverted: number;
    movements: number;
    by_currency: { currency: string; income: number | null; expense: number | null }[];
    income_by_category: CategoryTotal[];
    expense_by_category: CategoryTotal[];
  };
  payable: { count: number; total: number; variable: number; overdue_count: number; overdue_total: number; due_soon: number };
  recent: Pick<FinanceMovement, "id" | "account_id" | "direction" | "kind" | "amount" | "currency" | "occurred_on" | "category" | "counterparty" | "note">[];
}

const toNum = (v: unknown) => Number(v ?? 0);

export function useTreasurySummary(from: string | null, to: string, enabled = true) {
  const tenant = useTenantKey();
  return useQuery({
    enabled,
    queryKey: ["fin", tenant, "treasury", from, to],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      // Las cuotas se generan en el servidor; al abrir se completan las que falten.
      const refresh = await supabase.rpc("refresh_obligations");
      if (refresh.error) throw asError(refresh.error);
      const { data, error } = await supabase.rpc("treasury_summary", { p_from: from, p_to: to });
      if (error) throw asError(error);
      const s = data as TreasurySummary;
      const cats = (list: CategoryTotal[]) => list.map((c) => ({ ...c, amount: toNum(c.amount) }));
      return {
        ...s,
        rate: s.rate ? { ...s.rate, rate: toNum(s.rate.rate) } : null,
        accounts: s.accounts.map((a) => ({
          ...a,
          balance: toNum(a.balance),
          balance_base: num(a.balance_base),
          period_in: toNum(a.period_in),
          period_out: toNum(a.period_out),
        })),
        liquidity: { ...s.liquidity, total: toNum(s.liquidity.total), available: toNum(s.liquidity.available) },
        period: {
          ...s.period,
          income: toNum(s.period.income),
          expense: toNum(s.period.expense),
          by_currency: s.period.by_currency.map((c) => ({ ...c, income: num(c.income), expense: num(c.expense) })),
          income_by_category: cats(s.period.income_by_category),
          expense_by_category: cats(s.period.expense_by_category),
        },
        payable: { ...s.payable, total: toNum(s.payable.total), overdue_total: toNum(s.payable.overdue_total) },
        recent: s.recent.map((m) => ({ ...m, amount: toNum(m.amount) })),
      } as TreasurySummary;
    },
  });
}

export type CatalogKind = "category" | "counterparty";

export interface CatalogItem {
  id: string;
  kind: CatalogKind;
  name: string;
  direction: "in" | "out" | null;
  is_active: boolean;
}

export function useCatalog() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["fin", tenant, "catalog"],
    queryFn: async () => {
      const { data, error } = await supabase.from("finance_catalog_items").select("id, kind, name, direction, is_active").order("name");
      if (error) throw asError(error);
      return (data ?? []) as CatalogItem[];
    },
  });
}

export function useSaveCatalogItem() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: { id?: string; kind: CatalogKind; name: string; direction: "in" | "out" | null; is_active?: boolean }) => {
      const fields = { name: input.name.trim(), direction: input.kind === "category" ? input.direction : null, is_active: input.is_active ?? true };
      const { error } = input.id
        ? await supabase.from("finance_catalog_items").update(fields).eq("id", input.id)
        : await supabase.from("finance_catalog_items").insert({ ...fields, kind: input.kind });
      if (error) throw new Error(error.code === "23505" ? "Ya existe con ese nombre" : (error.message ?? "Error desconocido"));
    },
    onSuccess: invalidate,
  });
}

/** Nombres activos para sugerir al escribir; las categorías, según sean de ingreso o egreso. */
export function catalogNames(items: CatalogItem[], kind: CatalogKind, direction?: "in" | "out"): string[] {
  return items
    .filter((i) => i.kind === kind && i.is_active && (!direction || i.direction === null || i.direction === direction))
    .map((i) => i.name);
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

export function useMovements(filters: MovementFilters, enabled = true) {
  const tenant = useTenantKey();
  return useQuery({
    enabled,
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

// ---------------------------------------------------------------------------
// Enlazar pagos ya registrados a cuotas
// ---------------------------------------------------------------------------

export interface LinkCandidate {
  id: string;
  occurred_on: string;
  account_id: string;
  account_name: string;
  amount: number;
  currency: string;
  category: string | null;
  counterparty: string | null;
  reference: string | null;
  note: string | null;
  allocated: number;
  linked_here: boolean;
}

export interface MovementLink {
  id: string;
  movement_id: string;
  amount_allocated: number;
  amount_applied: number;
  movement: { occurred_on: string; amount: number; currency: string; reference: string | null; category: string | null; account_id: string } | null;
}

/** Egresos a mano del rango que se pueden enlazar a la cuota. */
export function useLinkCandidates(instanceId: string | null, from: string, to: string) {
  const tenant = useTenantKey();
  return useQuery({
    enabled: Boolean(instanceId),
    queryKey: ["fin", tenant, "link_candidates", instanceId, from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("obligation_link_candidates", { p_instance_id: instanceId, p_from: from, p_to: to });
      if (error) throw asError(error);
      return ((data ?? []) as LinkCandidate[]).map((m) => ({ ...m, amount: Number(m.amount), allocated: Number(m.allocated) }));
    },
  });
}

/** Movimientos enlazados a una cuota. */
export function useInstanceLinks(instanceId: string | null) {
  const tenant = useTenantKey();
  return useQuery({
    enabled: Boolean(instanceId),
    queryKey: ["fin", tenant, "instance_links", instanceId],
    queryFn: async () => {
      const { data: links, error } = await supabase
        .from("finance_movement_links")
        .select("id, movement_id, amount_allocated, amount_applied")
        .eq("obligation_instance_id", instanceId!);
      if (error) throw asError(error);
      const ids = (links ?? []).map((l) => l.movement_id);
      const { data: moves, error: e2 } = ids.length
        ? await supabase.from("finance_movements").select("id, occurred_on, amount, currency, reference, category, account_id").in("id", ids)
        : { data: [], error: null };
      if (e2) throw asError(e2);
      return (links ?? []).map((l) => {
        const m = (moves ?? []).find((x) => x.id === l.movement_id);
        return {
          ...l,
          amount_allocated: Number(l.amount_allocated),
          amount_applied: Number(l.amount_applied),
          movement: m ? { ...m, amount: Number(m.amount) } : null,
        };
      }) as MovementLink[];
    },
  });
}

export function useLinkMovement() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: { instanceId: string; movementId: string; amount?: number | null; applied?: number | null }) => {
      const { error } = await supabase.rpc("link_movement", {
        p_instance_id: input.instanceId,
        p_movement_id: input.movementId,
        p_amount: input.amount ?? null,
        p_applied: input.applied ?? null,
      });
      if (error) throw asError(error);
    },
    onSuccess: invalidate,
  });
}

export function useUnlinkMovement() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (linkId: string) => {
      const { error } = await supabase.rpc("unlink_movement", { p_link_id: linkId });
      if (error) throw asError(error);
    },
    onSuccess: invalidate,
  });
}
