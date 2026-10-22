import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { useAuth } from "./auth";
import { withOfflineCache } from "./offline";
import { getActiveTenantId, setActiveTenantId } from "./tenant";
import { pickInitialTenant, type Membership } from "./tenant-selection";

interface TenantState {
  memberships: Membership[];
  loading: boolean;
  error: Error | null;
  active: Membership | null;
  selectTenant: (tenantId: string) => void;
  clearTenant: () => void;
}

const TenantContext = createContext<TenantState | undefined>(undefined);

async function fetchMemberships(userId: string): Promise<Membership[]> {
  const { data, error } = await supabase
    .from("tenant_members")
    .select("role, tenant:tenants!inner(id, name, slug, status, base_currency, trial_ends_at, onboarding_completed_at)")
    .eq("user_id", userId)
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as unknown as Membership[];
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const userId = session?.user.id;
  const [activeId, setActiveId] = useState<string | null>(getActiveTenantId());

  const query = useQuery({
    queryKey: ["memberships", userId],
    // Con copia local: el POS tiene que poder arrancar en un apagón.
    queryFn: withOfflineCache(`memberships:${userId}`, () => fetchMemberships(userId!)),
    enabled: Boolean(userId),
  });
  const memberships = useMemo(() => query.data ?? [], [query.data]);

  useEffect(() => {
    if (!query.data) return;
    const initial = pickInitialTenant(query.data, getActiveTenantId());
    setActiveTenantId(initial);
    setActiveId(initial);
  }, [query.data]);

  useEffect(() => {
    if (!userId) {
      setActiveTenantId(null);
      setActiveId(null);
    }
  }, [userId]);

  const selectTenant = useCallback(
    (tenantId: string) => {
      setActiveTenantId(tenantId);
      setActiveId(tenantId);
      // Todo lo cacheado pertenece al tenant anterior.
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "memberships" });
    },
    [queryClient],
  );

  const clearTenant = useCallback(() => {
    setActiveTenantId(null);
    setActiveId(null);
  }, []);

  const active = memberships.find((m) => m.tenant.id === activeId) ?? null;

  return (
    <TenantContext.Provider
      value={{
        memberships,
        loading: query.isLoading,
        error: (query.error as Error | null) ?? null,
        active,
        selectTenant,
        clearTenant,
      }}
    >
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant(): TenantState {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenant debe usarse dentro de TenantProvider");
  return ctx;
}
