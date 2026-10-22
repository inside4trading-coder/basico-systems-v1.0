/**
 * Sedes en las que trabaja el usuario de la sesión (member_locations). null:
 * todas (sin asignaciones, o con el permiso de trabajar en todas las sedes). El servidor lo hace
 * cumplir; aquí solo se filtra lo que se ofrece.
 */
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/core/auth";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";
import { withOfflineCache } from "@/core/offline";

export function useAllowedLocations(): Set<string> | null {
  const { active, can } = useTenant();
  const { session } = useAuth();
  const tenant = active?.tenant.id ?? "none";
  const userId = session?.user.id ?? null;
  const unrestricted = can("inventario.todas_sedes");
  const { data } = useQuery({
    enabled: Boolean(userId) && !unrestricted,
    queryKey: ["team", tenant, "my_locations", userId],
    queryFn: withOfflineCache(`my_locations:${tenant}:${userId}`, async () => {
      const { data, error } = await supabase.from("member_locations").select("location_id").eq("user_id", userId);
      if (error) throw error;
      return (data ?? []).map((r) => r.location_id as string);
    }),
  });
  if (unrestricted || !data || data.length === 0) return null;
  return new Set(data);
}
