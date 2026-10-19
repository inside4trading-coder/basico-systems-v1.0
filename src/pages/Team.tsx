import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";
import { canManageTeam, type TenantRole } from "@/core/tenant-selection";
import AppShell, { ROLE_LABELS } from "@/components/AppShell";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLocations } from "@/modules/inventory/api";

type InvitableRole = Exclude<TenantRole, "owner">;

interface TeamMember {
  user_id: string;
  email: string | null;
  role: TenantRole;
}

async function readFunctionError(error: unknown): Promise<string> {
  const context = (error as { context?: Response }).context;
  if (context && typeof context.json === "function") {
    const body = await context.json().catch(() => null);
    if (body && typeof body.error === "string") return body.error;
  }
  return "No se pudo invitar";
}

export default function Team() {
  const { active } = useTenant();
  const queryClient = useQueryClient();
  const tenantId = active?.tenant.id;
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole>("cajero");
  const [feedback, setFeedback] = useState("");

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

  const invite = useMutation({
    mutationFn: async (target: string) => {
      const { data, error } = await supabase.functions.invoke("invite-member", {
        body: { tenant_id: tenantId, email: target, role },
      });
      if (error) throw new Error(await readFunctionError(error));
      return { ...(data as { invited: boolean }), target };
    },
    onSuccess: ({ invited, target }) => {
      setFeedback(invited ? `Invitación enviada a ${target}.` : `${target} ya tenía cuenta y quedó agregado al equipo.`);
      setEmail("");
      queryClient.invalidateQueries({ queryKey: ["team", tenantId] });
    },
    onError: (err: Error) => setFeedback(err.message),
  });

  if (!canManageTeam(active?.role)) return <Navigate to="/" replace />;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFeedback("");
    invite.mutate(email.trim());
  };

  return (
    <AppShell>
        <h1 className="text-2xl">Equipo</h1>

        <form
          onSubmit={submit}
          className="grid gap-3 rounded-surface border bg-card p-4 sm:grid-cols-[1fr_auto_auto] sm:items-end"
        >
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Correo</Label>
            <Input id="invite-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-role">Rol</Label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as InvitableRole)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="cajero">{ROLE_LABELS.cajero}</option>
              <option value="manager">{ROLE_LABELS.manager}</option>
              <option value="admin">{ROLE_LABELS.admin}</option>
            </select>
          </div>
          <Button type="submit" disabled={invite.isPending}>
            {invite.isPending ? "Invitando…" : "Invitar"}
          </Button>
          {feedback && (
            <p role="status" className="text-sm text-muted-foreground sm:col-span-3">
              {feedback}
            </p>
          )}
        </form>

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
