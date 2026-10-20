import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";
import { withOfflineCache } from "@/core/offline";

export interface CurrentRate {
  rate: number;
  source: "bcv" | "dolarapi" | "manual";
  effective_date: string;
  fetched_at: string;
  stale: boolean;
}

export interface TenantSettings {
  id: string;
  base_currency: string;
  local_currency: string | null;
  rate_source: "bcv" | "manual";
  is_special_taxpayer: boolean;
  prices_include_tax: boolean;
  igtf_rate: number;
  /** Datos para la nota de entrega. */
  name: string;
  legal_name: string | null;
  tax_id: string | null;
  address: string | null;
  phone: string | null;
  receipt_footer: string | null;
  /** "HH:MM:SS" desde la que el POS recuerda cerrar la caja; null = sin recordatorio. */
  closing_reminder_time: string | null;
  /** El POS no cobra sin origen de la venta. */
  channel_required: boolean;
}

/** Personal de caja: quien atiende, sin usuario propio. location_id null = todas las sedes. */
export interface Cashier {
  id: string;
  name: string;
  location_id: string | null;
  is_active: boolean;
}

export interface SalesChannel {
  id: string;
  name: string;
  is_active: boolean;
  position: number;
}

export interface TaxRate {
  id: string;
  name: string;
  rate: number;
  is_default: boolean;
  is_active: boolean;
}

export interface PaymentField {
  id: string;
  label: string;
  required?: boolean;
  type?: "text" | "bank";
}

export interface PaymentMethod {
  id: string;
  code: string;
  name: string;
  currency: string;
  kind: "cash" | "card" | "mobile_payment" | "transfer" | "zelle" | "bnpl" | "other";
  fields: PaymentField[];
  banks: string[];
  applies_igtf: boolean;
  is_active: boolean;
  position: number;
  /** Cuenta de Administración donde entra lo cobrado; null si no se registra. */
  account_id: string | null;
}

export interface TenantRateRow {
  id: string;
  rate: number;
  note: string | null;
  created_at: string;
}

function useTenantKey() {
  const { active } = useTenant();
  return active?.tenant.id ?? "none";
}

function asError(error: { message?: string } | null): Error {
  return new Error(error?.message ?? "Error desconocido");
}

export const RATE_SOURCE_LABEL: Record<CurrentRate["source"], string> = {
  bcv: "BCV",
  dolarapi: "BCV vía DolarAPI",
  manual: "Tasa propia",
};

export function useCurrentRate() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["cfg", tenant, "current_rate"],
    queryFn: withOfflineCache(`rate:${tenant}`, async () => {
      const { data, error } = await supabase.rpc("current_rate");
      if (error) throw error;
      const row = (data ?? [])[0] as CurrentRate | undefined;
      return row ? { ...row, rate: Number(row.rate) } : null;
    }),
    staleTime: 5 * 60 * 1000,
  });
}

/** Pide a la función exchange-rate-sync que consulte el BCV (o su respaldo). */
export function useRefreshRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("exchange-rate-sync", { body: {} });
      if (error) throw asError(error);
      return data as { ok: boolean; skipped?: boolean; source?: string; errors?: string[] };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cfg"] }),
  });
}

export function useTenantSettings() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["cfg", tenant, "tenant"],
    queryFn: withOfflineCache(`tenant:${tenant}`, async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("id, name, base_currency, local_currency, rate_source, is_special_taxpayer, prices_include_tax, igtf_rate, legal_name, tax_id, address, phone, receipt_footer, closing_reminder_time, channel_required")
        .eq("id", tenant)
        .single();
      if (error) throw error;
      return { ...data, igtf_rate: Number(data.igtf_rate) } as TenantSettings;
    }),
  });
}

export function useUpdateTenantSettings() {
  const qc = useQueryClient();
  const tenant = useTenantKey();
  return useMutation({
    mutationFn: async (patch: Partial<Omit<TenantSettings, "id" | "base_currency" | "local_currency">>) => {
      const { error } = await supabase.from("tenants").update(patch).eq("id", tenant);
      if (error) throw asError(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cfg"] }),
  });
}

export function useTenantRates() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["cfg", tenant, "tenant_rates"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tenant_rates").select("id, rate, note, created_at").order("created_at", { ascending: false }).limit(10);
      if (error) throw error;
      return (data ?? []).map((r) => ({ ...r, rate: Number(r.rate) })) as TenantRateRow[];
    },
  });
}

export function useSetTenantRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ base, quote, rate, note }: { base: string; quote: string; rate: number; note: string | null }) => {
      const { error } = await supabase.from("tenant_rates").insert({ base_currency: base, quote_currency: quote, rate, note });
      if (error) throw asError(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cfg"] }),
  });
}

export function useTaxRates() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["cfg", tenant, "tax_rates"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tax_rates").select("id, name, rate, is_default, is_active").order("rate", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((t) => ({ ...t, rate: Number(t.rate) })) as TaxRate[];
    },
  });
}

export function useSaveTaxRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id?: string; name?: string; rate?: number; is_active?: boolean }) => {
      const { id, ...fields } = input;
      const { error } = id ? await supabase.from("tax_rates").update(fields).eq("id", id) : await supabase.from("tax_rates").insert(fields);
      if (error) throw asError(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cfg"] }),
  });
}

/** Cambia la tasa por defecto: primero se quita la actual (índice único parcial). */
export function useSetDefaultTax() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error: clearError } = await supabase.from("tax_rates").update({ is_default: false }).eq("is_default", true);
      if (clearError) throw asError(clearError);
      const { error } = await supabase.from("tax_rates").update({ is_default: true, is_active: true }).eq("id", id);
      if (error) throw asError(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cfg"] }),
  });
}

export function usePaymentMethods() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["cfg", tenant, "payment_methods"],
    queryFn: withOfflineCache(`payment_methods:${tenant}`, async () => {
      const { data, error } = await supabase.from("payment_methods").select("*").order("position");
      if (error) throw error;
      return (data ?? []) as PaymentMethod[];
    }),
  });
}

/** Orígenes de venta (tienda, WhatsApp…). Con copia local: el POS los usa sin conexión. */
export function useSalesChannels() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["cfg", tenant, "sales_channels"],
    queryFn: withOfflineCache(`sales_channels:${tenant}`, async () => {
      const { data, error } = await supabase.from("sales_channels").select("id, name, is_active, position").order("position").order("name");
      if (error) throw error;
      return (data ?? []) as SalesChannel[];
    }),
  });
}

/** Con copia local: el POS elige cajero sin conexión. */
export function useCashiers() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["cfg", tenant, "cashiers"],
    queryFn: withOfflineCache(`cashiers:${tenant}`, async () => {
      const { data, error } = await supabase.from("cashiers").select("id, name, location_id, is_active").order("name");
      if (error) throw error;
      return (data ?? []) as Cashier[];
    }),
  });
}

export function useSaveCashier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id?: string; name?: string; location_id?: string | null; is_active?: boolean }) => {
      const { id, ...fields } = input;
      const { error } = id
        ? await supabase.from("cashiers").update(fields).eq("id", id)
        : await supabase.from("cashiers").insert({ name: fields.name?.trim(), location_id: fields.location_id ?? null });
      if (error) {
        if (error.code === "23505") throw new Error("Ya hay alguien con ese nombre.");
        throw asError(error);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cfg"] }),
  });
}

export function useSaveSalesChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id?: string; name?: string; is_active?: boolean; position?: number }) => {
      const { id, ...fields } = input;
      const { error } = id
        ? await supabase.from("sales_channels").update(fields).eq("id", id)
        : await supabase.from("sales_channels").insert({ name: fields.name?.trim(), position: fields.position ?? 99 });
      if (error) {
        if (error.code === "23505") throw new Error("Ya existe un origen con ese nombre.");
        throw asError(error);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cfg"] }),
  });
}

export function useSavePaymentMethod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<PaymentMethod> & { id?: string }) => {
      const { id, ...fields } = input;
      const { error } = id ? await supabase.from("payment_methods").update(fields).eq("id", id) : await supabase.from("payment_methods").insert(fields);
      if (error) throw asError(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cfg"] }),
  });
}

/** "Mi tienda: Efectivo €" → "mi_tienda_efectivo"; para códigos de métodos nuevos. */
export function slugCode(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^(\d)/, "m_$1")
      .slice(0, 31) || "metodo"
  );
}
