import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";
import { canManageTeam, type TenantRole } from "@/core/tenant-selection";
import AppShell, { ROLE_LABELS } from "@/components/AppShell";
import { Checkbox } from "@/components/ui/checkbox";
import InviteForm from "@/components/InviteForm";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLocations } from "@/modules/inventory/api";

interface TeamMember {
  user_id: string;
  email: string | null;
  role: TenantRole;
}

export default function Team() {
  const { active } = useTenant();
  const tenantId = active?.tenant.id;

  const team = useQuery({
    queryKey: ["team", tenantId],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_members")
        .select("user_id, email, role")
        .eq("tenant_id", tenantId!)
        .order("created_at");
      if (error) throw error;
      return data as TeamMember[];
    },
  });

  const access = useQuery({
    queryKey: ["team", tenantId, "member_locations"],
    enabled: Boolean(tenantId),
    queryFn: async () => {
      const { data, error } = await supabase.from("member_locations").select("user_id, location_id");
      if (error) throw error;
      return (data ?? []) as { user_id: string; location_id: string }[];
    },
  });
  const { data: locations = [] } = useLocations();
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const locationNames = (userId: string) => {
    const ids = (access.data ?? []).filter((a) => a.user_id === userId).map((a) => a.location_id);
    return ids.length === 0 ? "Todas las sedes" : locations.filter((l) => ids.includes(l.id)).map((l) => l.name).join(", ");
  };

  if (!canManageTeam(active?.role)) return <Navigate to="/" replace />;

  return (
    <AppShell>
        <h1 className="text-2xl">Equipo</h1>

        <InviteForm />

        <ul className="divide-y rounded-surface border bg-card">
          {team.data?.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <span className="min-w-0">
                <span className="block truncate">{m.email ?? m.user_id}</span>
                {(m.role === "manager" || m.role === "cajero") && locations.length > 1 && (
                  <span className="text-xs text-muted-foreground">{locationNames(m.user_id)}</span>
                )}
              </span>
              <span className="flex items-center gap-2">
                {(m.role === "manager" || m.role === "cajero") && locations.length > 1 && (
                  <Button size="sm" variant="outline" onClick={() => setEditing(m)}>
                    Sedes
                  </Button>
                )}
                <span className="mono-cap text-[10px] text-muted-foreground">{ROLE_LABELS[m.role]}</span>
              </span>
            </li>
          ))}
          {team.isError && <li className="px-4 py-3 text-sm text-destructive">No se pudo cargar el equipo.</li>}
        </ul>
        {editing && tenantId && (
          <LocationsDialog
            member={editing}
            tenantId={tenantId}
            locations={locations.map((l) => ({ id: l.id, name: l.name }))}
            current={(access.data ?? []).filter((a) => a.user_id === editing.user_id).map((a) => a.location_id)}
            onClose={() => setEditing(null)}
          />
        )}
    </AppShell>
  );
}

function LocationsDialog({ member, tenantId, locations, current, onClose }: {
  member: TeamMember;
  tenantId: string;
  locations: { id: string; name: string }[];
  current: string[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(current));
  const save = useMutation({
    mutationFn: async () => {
      const remove = current.filter((id) => !picked.has(id));
      const add = [...picked].filter((id) => !current.includes(id));
      if (remove.length) {
        const { error } = await supabase.from("member_locations").delete().eq("user_id", member.user_id).in("location_id", remove);
        if (error) throw error;
      }
      if (add.length) {
        const { error } = await supabase
          .from("member_locations")
          .insert(add.map((location_id) => ({ tenant_id: tenantId, user_id: member.user_id, location_id })));
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team", tenantId] });
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(v) => !v && !save.isPending && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Sedes de {member.email ?? "este usuario"}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Solo podrá abrir caja y mover inventario en las sedes marcadas. Sin ninguna marcada, trabaja en todas.
        </p>
        <ul className="space-y-2">
          {locations.map((l) => (
            <li key={l.id}>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={picked.has(l.id)}
                  onCheckedChange={(v) =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (v) next.add(l.id);
                      else next.delete(l.id);
                      return next;
                    })
                  }
                />
                {l.name}
              </label>
            </li>
          ))}
        </ul>
        {save.isError && <p className="text-sm text-destructive">No se pudo guardar: {(save.error as Error).message}</p>}
        <Button className="w-full" disabled={save.isPending} onClick={() => save.mutate()}>
          Guardar
        </Button>
      </DialogContent>
    </Dialog>
  );
}
