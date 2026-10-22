import { useState } from "react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { supabase } from "@/core/supabase";
import { useAuth } from "@/core/auth";
import { assignableRoles, canEditMember, teamErrorMessage } from "@/core/team";
import { useTenant } from "@/core/tenant-context";
import { type TenantRole } from "@/core/tenant-selection";
import AppShell, { ROLE_LABELS } from "@/components/AppShell";
import { Checkbox } from "@/components/ui/checkbox";
import InviteForm from "@/components/InviteForm";
import PermissionsMatrix from "@/components/PermissionsMatrix";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLocations } from "@/modules/inventory/api";

interface TeamMember {
  user_id: string;
  email: string | null;
  role: TenantRole;
}

export default function Team() {
  const { active, can } = useTenant();
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const tenantId = active?.tenant.id;
  const myRole = active?.role;
  const myUserId = session?.user.id;

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

  // Cambiar el rol o quitar a alguien: la RLS y keep_one_owner validan en la base.
  const changeMember = useMutation({
    mutationFn: async (change: { member: TeamMember; role?: TenantRole; remove?: boolean }) => {
      const query = change.remove
        ? supabase.from("tenant_members").delete().eq("tenant_id", tenantId!).eq("user_id", change.member.user_id).select("user_id")
        : supabase.from("tenant_members").update({ role: change.role }).eq("tenant_id", tenantId!).eq("user_id", change.member.user_id).select("user_id");
      const { data, error } = await query;
      if (error) throw new Error(teamErrorMessage(error.message));
      if (!data?.length) throw new Error(teamErrorMessage("permiso"));
    },
    onSuccess: (_data, change) => {
      toast.success(change.remove ? `${change.member.email ?? "La persona"} ya no está en el equipo` : "Rol actualizado");
      queryClient.invalidateQueries({ queryKey: ["team", tenantId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!can("equipo.gestionar")) return <Navigate to="/" replace />;

  return (
    <AppShell>
        <h1 className="text-2xl">Equipo</h1>

        <Tabs defaultValue="personas">
          <TabsList>
            <TabsTrigger value="personas">Personas</TabsTrigger>
            <TabsTrigger value="permisos">Permisos por rol</TabsTrigger>
          </TabsList>
          <TabsContent value="permisos">
            <PermissionsMatrix />
          </TabsContent>
          <TabsContent value="personas" className="space-y-6">
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
                {canEditMember(myRole, myUserId, m) ? (
                  <>
                    <select
                      aria-label={`Rol de ${m.email ?? "este usuario"}`}
                      value={m.role}
                      disabled={changeMember.isPending}
                      onChange={(e) => changeMember.mutate({ member: m, role: e.target.value as TenantRole })}
                      className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                    >
                      {assignableRoles(myRole).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={changeMember.isPending}
                      onClick={() => {
                        if (window.confirm(`¿Quitar a ${m.email ?? "esta persona"} del equipo? Ya no podrá entrar a este negocio.`)) {
                          changeMember.mutate({ member: m, remove: true });
                        }
                      }}
                    >
                      Quitar
                    </Button>
                  </>
                ) : (
                  <span className="mono-cap text-[10px] text-muted-foreground">
                    {ROLE_LABELS[m.role]}
                    {m.user_id === myUserId && " · tú"}
                  </span>
                )}
              </span>
            </li>
          ))}
          {team.isError && <li className="px-4 py-3 text-sm text-destructive">No se pudo cargar el equipo.</li>}
        </ul>
          </TabsContent>
        </Tabs>
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
