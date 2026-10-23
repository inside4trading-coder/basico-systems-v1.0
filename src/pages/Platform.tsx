import { useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import BrandMark from "@/components/BrandMark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/core/auth";
import { ENTITLEMENT_DEFAULTS } from "@/core/entitlements";
import {
  useCreateInvite,
  useExtendTrial,
  useIsPlatformAdmin,
  usePlatformInvites,
  usePlatformTenants,
  useSetTenantStatus,
  type PlatformInvite,
} from "@/modules/onboarding/api";
import {
  cleanRecipients,
  inviteEntitlements,
  MAX_INVITE_RECIPIENTS,
  RECIPIENT_ROLE_LABEL,
  recipientsProblem,
  signupUrl,
  trialDaysLeft,
  type InviteRecipient,
  type PlanForm,
} from "@/modules/onboarding/lib";

const ADDONS = [
  { key: "fichaje", label: "Fichaje" },
  { key: "estudio", label: "Estudio de IA" },
  { key: "cashea", label: "Cashea" },
] as const;

const QUOTAS = [
  { key: "max_locations", label: "Sedes" },
  { key: "max_registers", label: "Cajas" },
  { key: "max_users", label: "Usuarios" },
  { key: "estudio_images_per_month", label: "Fotos del Estudio al mes" },
] as const;

const PLAN_LABEL: Record<string, string> = Object.fromEntries([...ADDONS, ...QUOTAS].map((item) => [item.key, item.label]));

const STATE_LABEL: Record<PlatformInvite["state"], string> = {
  valido: "Vigente",
  unirse: "Falta que entren",
  usado: "Usado",
  vencido: "Vencido",
};

const FIRST_RECIPIENT: InviteRecipient = { email: "", role: "owner" };

const date = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("es-VE", { dateStyle: "medium", timeZone: "America/Caracas" }).format(new Date(iso)) : "—";

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Enlace copiado");
  } catch {
    toast.error("No se pudo copiar: selecciónalo a mano");
  }
}

function InviteForm() {
  const create = useCreateInvite();
  const [label, setLabel] = useState("");
  const [recipients, setRecipients] = useState<InviteRecipient[]>([FIRST_RECIPIENT]);
  const [trialDays, setTrialDays] = useState("30");
  const [validDays, setValidDays] = useState("7");
  const [plan, setPlan] = useState<PlanForm>({ ...ENTITLEMENT_DEFAULTS });
  const [created, setCreated] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = recipientsProblem(recipients);
    if (problem) return toast.error(problem);
    try {
      const code = await create.mutateAsync({
        label: label.trim(),
        recipients: cleanRecipients(recipients),
        entitlements: inviteEntitlements(plan),
        trialDays: trialDays.trim() === "" ? null : Number(trialDays),
        validDays: Number(validDays),
      });
      setCreated(signupUrl(code));
      setLabel("");
      setRecipients([FIRST_RECIPIENT]);
      setPlan({ ...ENTITLEMENT_DEFAULTS });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-surface border bg-card p-4">
      <h2 className="font-semibold">Nuevo enlace de alta</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="inv-label">Para quién</Label>
          <Input id="inv-label" required maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nombre del cliente" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inv-trial">Días de prueba</Label>
          <Input id="inv-trial" type="number" min={1} max={365} value={trialDays} onChange={(e) => setTrialDays(e.target.value)} placeholder="Vacío = sin fin" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inv-valid">El enlace vale (días)</Label>
          <Input id="inv-valid" type="number" min={1} max={90} required value={validDays} onChange={(e) => setValidDays(e.target.value)} />
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="mono-cap text-xs text-muted-foreground">Correos (opcional, hasta {MAX_INVITE_RECIPIENTS})</legend>
        <p className="text-xs text-muted-foreground">
          Comparte el mismo enlace con todos. Un dueño de la lista crea el negocio; los demás lo abren después y entran con su rol. Sin
          correos, cualquiera puede usarlo una vez.
        </p>
        <ul className="space-y-2">
          {recipients.map((r, index) => (
            <li key={index} className="flex gap-2">
              <Input
                type="email"
                aria-label={`Correo ${index + 1}`}
                value={r.email}
                onChange={(e) => setRecipients((list) => list.map((x, i) => (i === index ? { ...x, email: e.target.value } : x)))}
                placeholder="correo@negocio.com"
                className="flex-1"
              />
              <select
                aria-label={`Rol del correo ${index + 1}`}
                value={r.role}
                onChange={(e) =>
                  setRecipients((list) => list.map((x, i) => (i === index ? { ...x, role: e.target.value as InviteRecipient["role"] } : x)))
                }
                className="h-10 rounded-md border border-input bg-background px-2 text-sm"
              >
                {(Object.keys(RECIPIENT_ROLE_LABEL) as InviteRecipient["role"][]).map((role) => (
                  <option key={role} value={role}>
                    {RECIPIENT_ROLE_LABEL[role]}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`Quitar correo ${index + 1}`}
                disabled={recipients.length === 1}
                onClick={() => setRecipients((list) => list.filter((_, i) => i !== index))}
              >
                <X className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
        {recipients.length < MAX_INVITE_RECIPIENTS && (
          <Button type="button" size="sm" variant="outline" onClick={() => setRecipients((list) => [...list, { email: "", role: "admin" }])}>
            <Plus className="h-4 w-4" /> Agregar correo
          </Button>
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mono-cap text-xs text-muted-foreground">Complementos</legend>
        <div className="flex flex-wrap gap-4">
          {ADDONS.map((addon) => (
            <label key={addon.key} className="flex items-center gap-2 text-sm">
              <Switch aria-label={addon.label} checked={Boolean(plan[addon.key])} onCheckedChange={(v) => setPlan((p) => ({ ...p, [addon.key]: v }))} />
              {addon.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mono-cap text-xs text-muted-foreground">Cupos</legend>
        <div className="grid gap-3 sm:grid-cols-4">
          {QUOTAS.map((quota) => (
            <div key={quota.key} className="space-y-1.5">
              <Label htmlFor={`q-${quota.key}`} className="text-xs">
                {quota.label}
              </Label>
              <Input
                id={`q-${quota.key}`}
                type="number"
                min={0}
                value={String(plan[quota.key] ?? "")}
                onChange={(e) => setPlan((p) => ({ ...p, [quota.key]: Math.max(0, Number(e.target.value) || 0) }))}
              />
            </div>
          ))}
        </div>
      </fieldset>

      <Button type="submit" disabled={create.isPending}>
        {create.isPending ? "Creando…" : "Crear enlace"}
      </Button>

      {created && (
        <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
          <p className="text-sm font-medium">Enlace listo. Compártelo con todos los correos de la lista:</p>
          <div className="flex gap-2">
            <Input readOnly value={created} onFocus={(e) => e.target.select()} />
            <Button type="button" variant="outline" onClick={() => copy(created)}>
              Copiar
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}

function InviteList() {
  const invites = usePlatformInvites();
  if (invites.isLoading) return <p className="text-sm text-muted-foreground">Cargando…</p>;
  if (invites.isError) return <p className="text-sm text-destructive">{(invites.error as Error).message}</p>;
  if (!invites.data?.length) return <p className="text-sm text-muted-foreground">Todavía no hay enlaces.</p>;
  return (
    <ul className="divide-y rounded-surface border bg-card">
      {invites.data.map((invite) => {
        const extras = Object.entries(invite.entitlements).map(([k, v]) =>
          v === true ? PLAN_LABEL[k] ?? k : v === false ? `sin ${PLAN_LABEL[k] ?? k}` : `${PLAN_LABEL[k] ?? k}: ${v}`,
        );
        return (
          <li key={invite.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <div className="min-w-0 space-y-0.5">
              <p className="font-medium">
                {invite.label}{" "}
                <Badge variant={invite.state === "valido" ? "default" : "secondary"}>{STATE_LABEL[invite.state]}</Badge>
              </p>
              <p className="text-xs text-muted-foreground">
                {invite.recipients.length === 0
                  ? "Cualquier correo"
                  : invite.recipients
                      .map((r) => `${r.email} (${RECIPIENT_ROLE_LABEL[r.role]}${r.joined_at ? ", entró" : ""})`)
                      .join(", ")}{" "}
                · {invite.trial_days ? `${invite.trial_days} días de prueba` : "Sin fin de prueba"} · vence{" "}
                {date(invite.expires_at)}
                {extras.length > 0 && ` · ${extras.join(", ")}`}
                {invite.tenant_name && ` · Negocio: ${invite.tenant_name}`}
              </p>
            </div>
            {(invite.state === "valido" || invite.state === "unirse") && (
              <Button size="sm" variant="outline" onClick={() => copy(signupUrl(invite.code))}>
                Copiar enlace
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function TenantList() {
  const tenants = usePlatformTenants();
  const setStatus = useSetTenantStatus();
  const extend = useExtendTrial();

  const run = async (action: Promise<unknown>, ok: string) => {
    try {
      await action;
      toast.success(ok);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (tenants.isLoading) return <p className="text-sm text-muted-foreground">Cargando…</p>;
  if (tenants.isError) return <p className="text-sm text-destructive">{(tenants.error as Error).message}</p>;
  return (
    <ul className="divide-y rounded-surface border bg-card">
      {tenants.data?.map((t) => {
        const left = trialDaysLeft(t.trial_ends_at);
        return (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <div className="min-w-0 space-y-0.5">
              <p className="font-medium">
                {t.name}{" "}
                {t.status === "suspended" && <Badge variant="destructive">Suspendido</Badge>}
                {t.is_demo && <Badge variant="secondary">Demo</Badge>}
                {!t.onboarding_completed_at && <Badge variant="outline">Configurando</Badge>}
              </p>
              <p className="text-xs text-muted-foreground">
                {t.owner_email ?? "Sin dueño"} · {t.members} usuario{t.members === 1 ? "" : "s"} · {t.locations} sede
                {t.locations === 1 ? "" : "s"} · última venta {date(t.last_sale_at)} · alta {date(t.created_at)}
                {left !== null && ` · prueba ${left >= 0 ? `termina en ${left} día${left === 1 ? "" : "s"}` : "vencida"} (${date(t.trial_ends_at)})`}
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={extend.isPending} onClick={() => run(extend.mutateAsync({ tenantId: t.id, days: 15 }), "Prueba extendida 15 días")}>
                +15 días
              </Button>
              {t.status === "active" ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={setStatus.isPending}
                  onClick={() => {
                    if (window.confirm(`¿Suspender ${t.name}? Nadie del negocio podrá entrar hasta reactivarlo.`)) {
                      run(setStatus.mutateAsync({ tenantId: t.id, status: "suspended" }), "Negocio suspendido");
                    }
                  }}
                >
                  Suspender
                </Button>
              ) : (
                <Button size="sm" disabled={setStatus.isPending} onClick={() => run(setStatus.mutateAsync({ tenantId: t.id, status: "active" }), "Negocio reactivado")}>
                  Reactivar
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** /plataforma: enlaces de alta y negocios. Solo admins de plataforma. */
export default function Platform() {
  const { session, loading, signOut } = useAuth();
  const admin = useIsPlatformAdmin();

  if (loading || (session && admin.isLoading)) {
    return <p className="p-6 text-center text-xs text-muted-foreground">Cargando…</p>;
  }
  if (!session) return <Navigate to="/login" replace />;
  if (!admin.data) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen bg-background">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <BrandMark className="text-xl" />
          <span className="mono-cap text-xs text-muted-foreground">Plataforma</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Button asChild size="sm" variant="ghost">
            <Link to="/">Ir a la app</Link>
          </Button>
          <Button size="sm" variant="outline" onClick={signOut}>
            Salir
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-6 p-4">
        <Tabs defaultValue="enlaces">
          <TabsList>
            <TabsTrigger value="enlaces">Enlaces de alta</TabsTrigger>
            <TabsTrigger value="negocios">Negocios</TabsTrigger>
          </TabsList>
          <TabsContent value="enlaces" className="space-y-4">
            <InviteForm />
            <InviteList />
          </TabsContent>
          <TabsContent value="negocios">
            <TenantList />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
