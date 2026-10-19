/**
 * Caja y venta. El servidor calcula precios, tasa, impuestos e IGTF; aquí solo
 * se arma qué se vende y cómo se paga. Portado de useSublimeCashSession.ts y
 * del cobro de SublimePosApp.tsx (basicosystems@f551478b).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";

export interface Register {
  id: string;
  location_id: string;
  name: string;
  code: string;
  is_active: boolean;
}

export interface CashSession {
  id: string;
  register_id: string;
  location_id: string;
  number: string;
  status: "open" | "closed";
  opened_by: string;
  opened_at: string;
  closed_at: string | null;
}

export interface CashLine {
  currency: string;
  opening: number;
  expected: number;
  counted: number | null;
  difference: number | null;
}

export interface SessionSummary {
  session_id: string;
  number: string;
  status: "open" | "closed";
  opened_at: string;
  closed_at: string | null;
  cash: CashLine[];
  sales: { count: number; total: number; discount: number; tax: number; igtf: number };
  by_method: { method: string; currency: string; amount: number; amount_base: number }[];
}

export interface SaleItemInput {
  variant_id: string;
  qty: number;
  /** Descuento de la línea en moneda base. */
  discount?: number;
}

export interface SalePaymentInput {
  payment_method_id: string;
  amount: number;
  reference?: string;
  bank?: string;
  extra?: Record<string, string>;
}

export interface RegisterSaleInput {
  idempotencyKey: string;
  sessionId: string;
  items: SaleItemInput[];
  payments: SalePaymentInput[];
  cartDiscount?: number;
  change?: { currency: string; amount: number } | null;
  customer?: { name?: string; doc?: string } | null;
  note?: string | null;
}

export interface RegisterSaleResult {
  sale_id: string;
  number: string;
  total: number;
  igtf: number;
  rate: number | null;
  duplicate: boolean;
}

function useTenantKey() {
  const { active } = useTenant();
  return active?.tenant.id ?? "none";
}

function asError(error: { message?: string } | null): Error {
  return new Error(error?.message ?? "Error desconocido");
}

/** Clave para que reintentar el mismo cobro no duplique la venta. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function useRegisters() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["pos", tenant, "registers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("registers").select("id, location_id, name, code, is_active").order("code");
      if (error) throw error;
      return (data ?? []) as Register[];
    },
  });
}

export function useSaveRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<Register> & { id?: string }) => {
      const { id, ...fields } = input;
      const payload = { ...fields, ...(fields.code ? { code: fields.code.trim().toUpperCase() } : {}) };
      const { error } = id ? await supabase.from("registers").update(payload).eq("id", id) : await supabase.from("registers").insert(payload);
      if (error) throw asError(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pos"] }),
  });
}

/** Sesiones abiertas del negocio (una por caja como máximo). */
export function useOpenSessions() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["pos", tenant, "open_sessions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("cash_sessions").select("*").eq("status", "open").order("opened_at");
      if (error) throw error;
      return (data ?? []) as CashSession[];
    },
  });
}

export function useSessionSummary(sessionId: string | null) {
  const tenant = useTenantKey();
  return useQuery({
    enabled: Boolean(sessionId),
    queryKey: ["pos", tenant, "summary", sessionId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("cash_session_summary", { p_session_id: sessionId });
      if (error) throw asError(error);
      return data as SessionSummary;
    },
  });
}

export function useOpenSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ registerId, opening, note }: { registerId: string; opening: { currency: string; amount: number }[]; note?: string }) => {
      const { data, error } = await supabase.rpc("open_cash_session", { p_register_id: registerId, p_opening: opening, p_note: note ?? null });
      if (error) throw asError(error);
      return data as { session_id: string; number: string };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pos"] }),
  });
}

export function useCashMovement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { sessionId: string; kind: "cash_in" | "cash_out"; currency: string; amount: number; note: string }) => {
      const { error } = await supabase.rpc("cash_movement", {
        p_session_id: input.sessionId,
        p_kind: input.kind,
        p_currency: input.currency,
        p_amount: input.amount,
        p_note: input.note,
      });
      if (error) throw asError(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pos"] }),
  });
}

export function useCloseSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ sessionId, counted, note }: { sessionId: string; counted: { currency: string; amount: number }[]; note?: string }) => {
      const { data, error } = await supabase.rpc("close_cash_session", { p_session_id: sessionId, p_counted: counted, p_note: note ?? null });
      if (error) throw asError(error);
      return data as SessionSummary;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pos"] }),
  });
}

export async function registerSale(input: RegisterSaleInput): Promise<RegisterSaleResult> {
  const { data, error } = await supabase.rpc("register_sale", {
    p_idempotency_key: input.idempotencyKey,
    p_session_id: input.sessionId,
    p_items: input.items,
    p_payments: input.payments,
    p_cart_discount: input.cartDiscount ?? 0,
    p_change: input.change ?? null,
    p_customer: input.customer ?? null,
    p_note: input.note ?? null,
  });
  if (error) throw asError(error);
  return data as RegisterSaleResult;
}

export function useRegisterSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: registerSale,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pos"] });
      qc.invalidateQueries({ queryKey: ["inv"] });
    },
  });
}
