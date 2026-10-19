import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";
import { canManageTeam, type TenantRole } from "@/core/tenant-selection";
import { AppHeader } from "./Home";

const ROLE_LABELS: Record<TenantRole, string> = {
  owner: "Dueño",
  admin: "Administrador",
  manager: "Encargado",
  cajero: "Cajero",
};

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
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-3xl space-y-6 p-4">
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
            <li key={m.user_id} className="flex items-center justify-between px-4 py-3 text-sm">
              <span>{m.email ?? m.user_id}</span>
              <span className="mono-cap text-[10px] text-muted-foreground">{ROLE_LABELS[m.role]}</span>
            </li>
          ))}
          {team.isError && <li className="px-4 py-3 text-sm text-destructive">No se pudo cargar el equipo.</li>}
        </ul>
      </main>
    </div>
  );
}
