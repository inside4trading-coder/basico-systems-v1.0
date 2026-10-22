import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/core/supabase";
import { useAuth } from "@/core/auth";

function fail(error: { message: string } | null, fallback: string): never {
  throw new Error(error?.message || fallback);
}

// ---------------------------------------------------------------------------
// Enlace de alta
// ---------------------------------------------------------------------------

export type InviteInfo =
  | { valid: true; label: string; email: string | null }
  | { valid: false; reason: "no_existe" | "usado" | "vencido" };

export const INVALID_REASONS: Record<"no_existe" | "usado" | "vencido", string> = {
  no_existe: "Este enlace de alta no existe. Revisa que esté completo o pide uno nuevo.",
  usado: "Este enlace ya se usó para crear un negocio. Si fuiste tú, entra con tu correo y contraseña.",
  vencido: "Este enlace de alta venció. Pide uno nuevo.",
};

export function useInviteInfo(code: string | undefined) {
  return useQuery({
    queryKey: ["signup-invite", code],
    enabled: Boolean(code),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("signup_invite_info", { p_code: code! });
      if (error) fail(error, "No se pudo revisar el enlace");
      return data as InviteInfo;
    },
  });
}

export interface SignupInput {
  code: string;
  email: string;
  password: string;
  fullName: string;
}

/** Crea la cuenta con el enlace. `existing` indica que el correo ya tenía cuenta. */
export async function createSignupAccount(input: SignupInput): Promise<{ existing: boolean }> {
  const { data, error } = await supabase.functions.invoke("onboarding-signup", {
    body: { code: input.code, email: input.email, password: input.password, full_name: input.fullName },
  });
  if (error) throw new Error("No se pudo crear la cuenta. Revisa tu conexión e intenta de nuevo.");
  if (data?.existing) return { existing: true };
  if (data?.error) throw new Error(data.error as string);
  return { existing: false };
}

export async function redeemInvite(code: string, businessName: string): Promise<string> {
  const { data, error } = await supabase.rpc("redeem_signup_invite", { p_code: code, p_business_name: businessName });
  if (error) fail(error, "No se pudo crear el negocio");
  return data as string;
}

// ---------------------------------------------------------------------------
// Plataforma
// ---------------------------------------------------------------------------

export function useIsPlatformAdmin() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ["platform-admin", userId],
    enabled: Boolean(userId),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_platform_admin");
      if (error) return false;
      return data === true;
    },
  });
}

export interface PlatformInvite {
  id: string;
  code: string;
  label: string;
  email: string | null;
  entitlements: Record<string, boolean | number>;
  trial_days: number | null;
  expires_at: string;
  signups: number;
  state: "valido" | "usado" | "vencido";
  tenant_id: string | null;
  tenant_name: string | null;
  redeemed_at: string | null;
  created_at: string;
}

export interface PlatformTenant {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended";
  is_demo: boolean;
  owner_email: string | null;
  members: number;
  locations: number;
  last_sale_at: string | null;
  trial_ends_at: string | null;
  onboarding_completed_at: string | null;
  created_at: string;
}

export function usePlatformInvites() {
  return useQuery({
    queryKey: ["platform", "invites"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("platform_invites");
      if (error) fail(error, "No se pudieron cargar los enlaces");
      return (data ?? []) as PlatformInvite[];
    },
  });
}

export function usePlatformTenants() {
  return useQuery({
    queryKey: ["platform", "tenants"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("platform_tenants");
      if (error) fail(error, "No se pudieron cargar los negocios");
      return (data ?? []) as PlatformTenant[];
    },
  });
}

export interface NewInvite {
  label: string;
  email: string;
  entitlements: Record<string, boolean | number>;
  trialDays: number | null;
  validDays: number;
}

export function useCreateInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewInvite) => {
      const { data, error } = await supabase.rpc("platform_create_invite", {
        p_label: input.label,
        p_email: input.email,
        p_entitlements: input.entitlements,
        p_trial_days: input.trialDays,
        p_valid_days: input.validDays,
      });
      if (error) fail(error, "No se pudo crear el enlace");
      return data as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["platform"] }),
  });
}

export function useSetTenantStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ tenantId, status }: { tenantId: string; status: "active" | "suspended" }) => {
      const { error } = await supabase.rpc("platform_set_tenant_status", { p_tenant: tenantId, p_status: status });
      if (error) fail(error, "No se pudo cambiar el estado");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["platform"] }),
  });
}

export function useExtendTrial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ tenantId, days }: { tenantId: string; days: number }) => {
      const { error } = await supabase.rpc("platform_extend_trial", { p_tenant: tenantId, p_days: days });
      if (error) fail(error, "No se pudo extender la prueba");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["platform"] }),
  });
}

// ---------------------------------------------------------------------------
// Asistente inicial
// ---------------------------------------------------------------------------

export interface OnboardingState {
  onboarding_steps: Record<string, string>;
  onboarding_completed_at: string | null;
}

export function useOnboardingState(tenantId: string | undefined) {
  return useQuery({
    queryKey: ["onboarding", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("onboarding_steps, onboarding_completed_at")
        .eq("id", tenantId!)
        .single();
      if (error) fail(error, "No se pudo cargar el asistente");
      return data as OnboardingState;
    },
  });
}

export interface BusinessSetup {
  name: string;
  legalName: string;
  taxId: string;
  phone: string;
  address: string;
  locationName: string;
  rateSource: "bcv" | "manual";
  manualRate: number | null;
  specialTaxpayer: boolean;
}

export function useSetupBusiness() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BusinessSetup) => {
      const { error } = await supabase.rpc("onboarding_setup_business", {
        p_name: input.name,
        p_legal_name: input.legalName,
        p_tax_id: input.taxId,
        p_phone: input.phone,
        p_address: input.address,
        p_location_name: input.locationName,
        p_rate_source: input.rateSource,
        p_manual_rate: input.manualRate,
        p_special_taxpayer: input.specialTaxpayer,
      });
      if (error) fail(error, "No se pudo guardar el negocio");
    },
    // Cambian el nombre, la tasa, las sedes y las cajas.
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "platform-admin" }),
  });
}

export function useMarkStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (step: "productos" | "equipo" | "listo") => {
      const { error } = await supabase.rpc("onboarding_mark", { p_step: step });
      if (error) fail(error, "No se pudo guardar el avance");
    },
    onSuccess: (_data, step) => {
      qc.invalidateQueries({ queryKey: ["onboarding"] });
      if (step === "listo") qc.invalidateQueries({ queryKey: ["memberships"] });
    },
  });
}

export function useProductCount(tenantId: string | undefined) {
  return useQuery({
    queryKey: ["onboarding", tenantId, "products"],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { count, error } = await supabase.from("products").select("id", { count: "exact", head: true }).is("deleted_at", null);
      if (error) fail(error, "No se pudieron contar los productos");
      return count ?? 0;
    },
  });
}
