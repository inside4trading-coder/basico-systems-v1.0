import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ROLE_LABELS } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";
import type { TenantRole } from "@/core/tenant-selection";

type InvitableRole = Exclude<TenantRole, "owner">;

async function readFunctionError(error: unknown): Promise<string> {
  const context = (error as { context?: Response }).context;
  if (context && typeof context.json === "function") {
    const body = await context.json().catch(() => null);
    if (body && typeof body.error === "string") return body.error;
  }
  return "No se pudo invitar";
}

/** Invitar a alguien al equipo por correo con su rol (Equipo y asistente inicial). */
export default function InviteForm({ onInvited }: { onInvited?: (email: string, role: InvitableRole) => void }) {
  const { active } = useTenant();
  const queryClient = useQueryClient();
  const tenantId = active?.tenant.id;
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole>("cajero");
  const [feedback, setFeedback] = useState("");

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
      onInvited?.(target, role);
    },
    onError: (err: Error) => setFeedback(err.message),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFeedback("");
    invite.mutate(email.trim());
  };

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-surface border bg-card p-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
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
  );
}
