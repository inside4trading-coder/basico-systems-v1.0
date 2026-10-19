import { useQuery } from "@tanstack/react-query";
import { ENTITLEMENT_DEFAULTS, resolveEntitlements, type EntitlementRow, type Entitlements } from "./entitlements";
import { withOfflineCache } from "./offline";
import { supabase } from "./supabase";
import { useTenant } from "./tenant-context";

/**
 * Módulos y cuotas del negocio activo. Mientras carga devuelve los defaults:
 * la base hace cumplir el plan igual, la pantalla solo evita ofrecer lo que
 * no está incluido.
 */
export function useEntitlements(): Entitlements {
  const { active } = useTenant();
  const tenantId = active?.tenant.id;
  const { data } = useQuery({
    queryKey: ["entitlements", tenantId],
    // Con copia local: el menú del POS no puede depender de la conexión.
    queryFn: withOfflineCache(`entitlements:${tenantId}`, async () => {
      const { data, error } = await supabase.from("tenant_entitlements").select("key, value, expires_at");
      if (error) throw error;
      return (data ?? []) as EntitlementRow[];
    }),
    enabled: Boolean(tenantId),
    staleTime: 5 * 60_000,
  });
  return data ? resolveEntitlements(data) : { ...ENTITLEMENT_DEFAULTS };
}

export interface PlanUsage {
  locations: number;
  registers: number;
  users: number;
}

/** Sedes, cajas activas y usuarios en uso (solo dueño o administrador). */
export function usePlanUsage(enabled: boolean) {
  const { active } = useTenant();
  return useQuery({
    queryKey: ["plan-usage", active?.tenant.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("plan_usage");
      if (error) throw error;
      return data as PlanUsage;
    },
    enabled: enabled && Boolean(active),
  });
}
