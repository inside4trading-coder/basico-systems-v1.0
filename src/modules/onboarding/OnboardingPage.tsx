import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Check, FileSpreadsheet, PackagePlus, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import InviteForm from "@/components/InviteForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTenant } from "@/core/tenant-context";
import { cn } from "@/lib/utils";
import NewProductDialog from "@/modules/inventory/NewProductDialog";
import { useLocations } from "@/modules/inventory/api";
import { parseAmount } from "@/modules/inventory/import/preview";
import { RATE_SOURCE_LABEL, useCurrentRate, useRefreshRate, useTenantSettings } from "@/modules/settings/api";
import { useMarkStep, useOnboardingState, useProductCount, useSetupBusiness } from "./api";
import { firstPendingStep, WIZARD_STEPS, type WizardStep } from "./lib";

const STEP_LABEL: Record<WizardStep, string> = {
  negocio: "Tu negocio",
  productos: "Productos",
  equipo: "Equipo",
  listo: "Listo",
};

const fmtRate = (n: number) => new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n);

function Stepper({ current, done, onPick }: { current: WizardStep; done: Record<string, string>; onPick: (s: WizardStep) => void }) {
  return (
    <ol className="grid grid-cols-4 gap-2" aria-label="Pasos">
      {WIZARD_STEPS.map((step, i) => {
        const isDone = Boolean(done[step]);
        const isCurrent = step === current;
        return (
          <li key={step}>
            <button
              type="button"
              onClick={() => onPick(step)}
              aria-current={isCurrent ? "step" : undefined}
              className={cn(
                "flex w-full flex-col items-start gap-1 border-t-2 pt-2 text-left text-xs transition-colors",
                isCurrent ? "border-primary text-foreground" : isDone ? "border-primary/40 text-muted-foreground" : "border-border text-muted-foreground",
              )}
            >
              <span className="mono-cap flex items-center gap-1">
                {isDone ? <Check className="h-3 w-3" aria-hidden /> : `${i + 1}.`}
                {/* En el teléfono solo cabe el nombre del paso actual. */}
                <span className={isCurrent ? undefined : "sr-only sm:not-sr-only"}>{STEP_LABEL[step]}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-surface border bg-card p-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function BusinessStep({ onDone }: { onDone: () => void }) {
  const { data: settings } = useTenantSettings();
  const { data: locations = [] } = useLocations();
  const { data: current } = useCurrentRate();
  const refresh = useRefreshRate();
  const setup = useSetupBusiness();
  const existingLocation = locations[0];

  const [form, setForm] = useState({
    name: "",
    legalName: "",
    taxId: "",
    phone: "",
    address: "",
    locationName: "Principal",
    rateSource: "bcv" as "bcv" | "manual",
    manualRate: "",
    specialTaxpayer: false,
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!settings || loaded) return;
    setForm((f) => ({
      ...f,
      name: settings.name ?? "",
      legalName: settings.legal_name ?? "",
      taxId: settings.tax_id ?? "",
      phone: settings.phone ?? "",
      address: settings.address ?? "",
      rateSource: settings.rate_source,
      specialTaxpayer: settings.is_special_taxpayer,
    }));
    setLoaded(true);
  }, [settings, loaded]);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));
  const usesRate = Boolean(settings?.local_currency);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const manual = form.rateSource === "manual" ? parseAmount(form.manualRate) : null;
    if (usesRate && form.rateSource === "manual" && (manual == null || Number.isNaN(manual) || manual <= 0)) {
      return toast.error("Escribe la tasa del día");
    }
    try {
      await setup.mutateAsync({
        name: form.name.trim(),
        legalName: form.legalName,
        taxId: form.taxId,
        phone: form.phone,
        address: form.address,
        locationName: existingLocation?.name ?? form.locationName,
        rateSource: form.rateSource,
        manualRate: manual,
        specialTaxpayer: form.specialTaxpayer,
      });
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Section title="Tu negocio" description="Estos datos salen en la nota de entrega. Puedes cambiarlos después en Configuración.">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ob-name">Nombre comercial</Label>
            <Input id="ob-name" required maxLength={80} value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ob-legal">Razón social (opcional)</Label>
            <Input id="ob-legal" maxLength={120} value={form.legalName} onChange={(e) => set("legalName", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ob-rif">RIF (opcional)</Label>
            <Input id="ob-rif" maxLength={30} value={form.taxId} onChange={(e) => set("taxId", e.target.value)} placeholder="J-12345678-9" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ob-phone">Teléfono (opcional)</Label>
            <Input id="ob-phone" type="tel" maxLength={40} value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ob-address">Dirección (opcional)</Label>
            <Input id="ob-address" maxLength={200} value={form.address} onChange={(e) => set("address", e.target.value)} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ob-location">Sede principal</Label>
          {existingLocation ? (
            <p className="text-sm text-muted-foreground">
              {existingLocation.name} (ya creada). Más sedes y cajas se agregan en Sedes.
            </p>
          ) : (
            <>
              <Input id="ob-location" required maxLength={60} value={form.locationName} onChange={(e) => set("locationName", e.target.value)} />
              <p className="text-xs text-muted-foreground">La tienda o el almacén donde está tu mercancía. Se crea con «Caja 1» para vender.</p>
            </>
          )}
        </div>

        {usesRate && (
          <fieldset className="space-y-3 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">
              Tasa {settings?.base_currency}/{settings?.local_currency}
            </legend>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Fuente de la tasa">
              {(["bcv", "manual"] as const).map((source) => (
                <Button
                  key={source}
                  type="button"
                  role="radio"
                  aria-checked={form.rateSource === source}
                  variant={form.rateSource === source ? "default" : "outline"}
                  size="sm"
                  onClick={() => set("rateSource", source)}
                >
                  {source === "bcv" ? "Tasa oficial BCV" : "Tasa propia"}
                </Button>
              ))}
            </div>
            {form.rateSource === "bcv" ? (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                {current ? (
                  <span>
                    Hoy: <span className="num font-semibold">{fmtRate(current.rate)}</span>{" "}
                    <span className="text-muted-foreground">({RATE_SOURCE_LABEL[current.source]})</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">Todavía no hay tasa cargada.</span>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={refresh.isPending}
                  onClick={() => refresh.mutate(undefined, { onError: (e) => toast.error((e as Error).message) })}
                >
                  <RefreshCcw /> Consultar BCV
                </Button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="ob-rate">Tasa del día</Label>
                <Input id="ob-rate" inputMode="decimal" value={form.manualRate} onChange={(e) => set("manualRate", e.target.value)} placeholder="Ej. 40,50" className="max-w-40" />
              </div>
            )}
          </fieldset>
        )}

        <label className="flex items-center gap-3 text-sm">
          <Switch checked={form.specialTaxpayer} onCheckedChange={(v) => set("specialTaxpayer", v)} aria-label="Contribuyente especial" />
          Soy contribuyente especial
        </label>
        <p className="text-xs text-muted-foreground">El IVA queda en 16 % por defecto, con 8 % y exento disponibles.</p>

        <Button type="submit" disabled={setup.isPending}>
          {setup.isPending ? "Guardando…" : "Guardar y continuar"}
        </Button>
      </form>
    </Section>
  );
}

function ProductsStep({ tenantId, currency, onDone }: { tenantId: string; currency: string; onDone: () => void }) {
  const { data: count = 0, refetch } = useProductCount(tenantId);
  const [creating, setCreating] = useState(false);

  return (
    <Section title="Tus productos" description="Carga tu catálogo para empezar a vender. Puedes hacerlo ahora o después.">
      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          to="/inventario/importar?desde=bienvenida"
          className="flex flex-col gap-2 rounded-md border p-4 transition-colors hover:border-primary"
        >
          <FileSpreadsheet className="h-5 w-5 text-primary" aria-hidden />
          <span className="font-medium">Importar desde Excel</span>
          <span className="text-sm text-muted-foreground">Baja la plantilla, llénala con tus productos, precios y existencias, y súbela.</span>
        </Link>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex flex-col gap-2 rounded-md border p-4 text-left transition-colors hover:border-primary"
        >
          <PackagePlus className="h-5 w-5 text-primary" aria-hidden />
          <span className="font-medium">Crear un producto</span>
          <span className="text-sm text-muted-foreground">Agrega uno a mano para probar el punto de venta.</span>
        </button>
      </div>
      <p className="text-sm" role="status">
        {count === 0 ? "Todavía no tienes productos." : `Tienes ${count} producto${count === 1 ? "" : "s"}.`}
      </p>
      <Button onClick={onDone}>{count === 0 ? "Lo hago después" : "Continuar"}</Button>
      <NewProductDialog
        open={creating}
        onOpenChange={(open) => {
          setCreating(open);
          // Al cerrar el diálogo, el conteo refleja el producto nuevo.
          if (!open) refetch();
        }}
        currency={currency}
      />
    </Section>
  );
}

function TeamStep({ onDone }: { onDone: () => void }) {
  const [invited, setInvited] = useState<string[]>([]);
  return (
    <Section
      title="Tu equipo"
      description="Invita a tus cajeros y encargados. Les llega un correo para crear su contraseña. Cada uno ve solo lo que su rol permite."
    >
      <InviteForm onInvited={(email) => setInvited((list) => [...list, email])} />
      {invited.length > 0 && (
        <ul className="space-y-1 text-sm">
          {invited.map((email) => (
            <li key={email} className="flex items-center gap-2">
              <Check className="h-4 w-4 text-primary" aria-hidden /> {email}
            </li>
          ))}
        </ul>
      )}
      <Button onClick={onDone}>{invited.length === 0 ? "Lo hago después" : "Continuar"}</Button>
    </Section>
  );
}

function DoneStep({ done, onFinish, finishing }: { done: Record<string, string>; onFinish: (to: string) => void; finishing: boolean }) {
  const items: [WizardStep, string, string][] = [
    ["negocio", "Datos del negocio, sede y caja", "/configuracion"],
    ["productos", "Productos", "/inventario"],
    ["equipo", "Equipo", "/equipo"],
  ];
  return (
    <Section title="¡Listo para vender!" description="Tu negocio está configurado. Lo que dejaste para después lo encuentras en el menú.">
      <ul className="space-y-2 text-sm">
        {items.map(([step, label, to]) => (
          <li key={step} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Check className={cn("h-4 w-4", done[step] ? "text-primary" : "text-muted-foreground/40")} aria-hidden />
              {label}
            </span>
            <Link to={to} className="text-xs text-muted-foreground underline-offset-4 hover:underline">
              Revisar
            </Link>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button disabled={finishing} onClick={() => onFinish("/pos")}>
          Abrir el punto de venta
        </Button>
        <Button variant="outline" disabled={finishing} onClick={() => onFinish("/")}>
          Ir al inicio
        </Button>
      </div>
    </Section>
  );
}

/** /bienvenida: asistente inicial del dueño o administrador. */
export default function OnboardingPage() {
  const { active, can } = useTenant();
  const navigate = useNavigate();
  const tenantId = active?.tenant.id;
  const state = useOnboardingState(tenantId);
  const mark = useMarkStep();
  const [step, setStep] = useState<WizardStep | null>(null);
  const done = state.data?.onboarding_steps ?? {};

  useEffect(() => {
    if (state.data && step === null) setStep(firstPendingStep(state.data.onboarding_steps));
  }, [state.data, step]);

  if (!can("config.negocio")) return <Navigate to="/" replace />;

  const next = async (from: "productos" | "equipo") => {
    try {
      await mark.mutateAsync(from);
      setStep(from === "productos" ? "equipo" : "listo");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const finish = async (to: string) => {
    try {
      await mark.mutateAsync("listo");
      navigate(to);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <AppShell>
      <div className="space-y-1">
        <p className="mono-cap text-xs text-muted-foreground">Primeros pasos</p>
        <h1 className="text-2xl">Configura {active?.tenant.name}</h1>
      </div>
      {state.isLoading || !step || !tenantId ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : state.isError ? (
        <p className="text-sm text-destructive">{(state.error as Error).message}</p>
      ) : (
        <>
          <Stepper current={step} done={done} onPick={setStep} />
          {step === "negocio" && <BusinessStep onDone={() => setStep(firstPendingStep({ ...done, negocio: "x" }))} />}
          {step === "productos" && <ProductsStep tenantId={tenantId} currency={active?.tenant.base_currency ?? "USD"} onDone={() => next("productos")} />}
          {step === "equipo" && <TeamStep onDone={() => next("equipo")} />}
          {step === "listo" && <DoneStep done={done} onFinish={finish} finishing={mark.isPending} />}
        </>
      )}
    </AppShell>
  );
}
