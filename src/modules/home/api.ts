import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/core/auth";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";

/** Accesos guardados del usuario en el negocio activo; null = los de siempre. */
export function useHomeShortcuts() {
  const { active } = useTenant();
  const userId = useAuth().session?.user.id;
  return useQuery({
    queryKey: ["home-shortcuts", active?.tenant.id, userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_members")
        .select("home_shortcuts")
        .eq("tenant_id", active!.tenant.id)
        .eq("user_id", userId!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return ((data as { home_shortcuts: string[] | null } | null)?.home_shortcuts ?? null) as string[] | null;
    },
    enabled: Boolean(active && userId),
  });
}

export function useSaveHomeShortcuts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (keys: string[] | null) => {
      const { error } = await supabase.rpc("set_home_shortcuts", { p_keys: keys });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["home-shortcuts"] }),
  });
}
