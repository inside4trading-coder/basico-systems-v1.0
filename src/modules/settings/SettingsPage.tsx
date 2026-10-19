/**
 * Configuración del negocio para cobrar: tasa de cambio, impuestos y métodos
 * de pago. Reemplaza la pantalla TasaBCV de Sublime y la lista fija de
 * posPaymentMethods.ts (basicosystems@f551478b).
 */
import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTenant } from "@/core/tenant-context";
import { canManageTeam, canSupervise } from "@/core/tenant-selection";
import ExportSection from "./ExportSection";
import { formatDateTime } from "@/modules/inventory/lib";
import { parseAmount } from "@/modules/inventory/import/preview";
import {
  RATE_SOURCE_LABEL,
  slugCode,
  useCurrentRate,
  usePaymentMethods,
  useRefreshRate,
  useSavePaymentMethod,
  useSaveTaxRate,
  useSetDefaultTax,
  useSetTenantRate,
  useTaxRates,
  useTenantRates,
  useTenantSettings,
  useUpdateTenantSettings,
  type PaymentMethod,
} from "./api";

const KIND_LABEL: Record<PaymentMethod["kind"], string> = {
  cash: "Efectivo",
  card: "Punto de venta",
  mobile_payment: "Pago móvil",
  transfer: "Transferencia",
  zelle: "Zelle",
  bnpl: "Cuotas (Cashea)",
  other: "Otro",
};

const fmtRate = (n: number) => n.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const errorToast = (title: string) => (err: Error) => toast.error(title, { description: err.message });

export default function SettingsPage() {
  const { active } = useTenant();
  if (!canSupervise(active?.role)) return <Navigate to="/" replace />;
  return (
    <AppShell>
      <h1 className="text-2xl">Configuración</h1>
      <RateSection />
      <TaxSection />
      <PaymentMethodsSection />
      {canManageTeam(active?.role) && <ExportSection />}
    </AppShell>
  );
}

/* ---------------- Tasa de cambio ---------------- */

function RateSection() {
  const { data: settings } = useTenantSettings();
  const { data: current, isLoading } = useCurrentRate();
  const { data: history = [] } = useTenantRates();
  const refresh = useRefreshRate();
  const update = useUpdateTenantSettings();
  const setRate = useSetTenantRate();
  const [rate, setRateText] = useState("");
  const [note, setNote] = useState("");

  if (!settings) return null;
  if (!settings.local_currency) {
    return (
      <Card className="space-y-1 p-4">
        <p className="mono-cap text-xs text-muted-foreground">Tasa de cambio</p>
        <p className="text-sm">Este negocio trabaja solo en {settings.base_currency}: no usa tasa.</p>
      </Card>
    );
  }
  const pair = `${settings.base_currency}/${settings.local_currency}`;

  const saveRate = (event: FormEvent) => {
    event.preventDefault();
    const n = parseAmount(rate);
    if (n == null || Number.isNaN(n) || n <= 0) return toast.error("Escribe una tasa válida");
    setRate.mutate(
      { base: settings.base_currency, quote: settings.local_currency!, rate: n, note: note.trim() || null },
      {
        onSuccess: () => {
          toast.success(`Tasa ${pair} fijada en ${fmtRate(n)}`);
          setRateText("");
          setNote("");
        },
        onError: errorToast("No se pudo fijar la tasa"),
      },
    );
  };

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mono-cap text-xs text-muted-foreground">Tasa de cambio {pair}</p>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : current ? (
            <>
              <p className="num text-3xl font-bold">{fmtRate(current.rate)}</p>
              <p className="text-xs text-muted-foreground">
                {RATE_SOURCE_LABEL[current.source]} · rige desde {new Date(`${current.effective_date}T12:00:00`).toLocaleDateString("es-VE")} · consultada{" "}
                {formatDateTime(current.fetched_at)}
              </p>
              {current.stale && <Badge variant="destructive" className="mt-1">Tasa vieja: revisa la fuente o fija una propia</Badge>}
            </>
          ) : (
            <p className="text-sm">Todavía no hay tasa. {settings.rate_source === "bcv" ? "Toca «Consultar BCV»." : "Fija una tasa propia."}</p>
          )}
        </div>
        {settings.rate_source === "bcv" && (
          <Button
            variant="outline"
            disabled={refresh.isPending}
            onClick={() =>
              refresh.mutate(undefined, {
                onSuccess: (r) =>
                  r.skipped
                    ? toast.info("Se consultó hace menos de 30 minutos")
                    : toast.success(`Tasa actualizada desde ${r.source === "bcv" ? "el BCV" : "DolarAPI"}`, {
                        description: r.errors?.length ? `El BCV no respondió: ${r.errors[0]}` : undefined,
                      }),
                onError: errorToast("No se pudo consultar"),
              })
            }
          >
            <RefreshCcw /> Consultar BCV
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {(["bcv", "manual"] as const).map((src) => (
          <Button
            key={src}
            size="sm"
            variant={settings.rate_source === src ? "default" : "outline"}
            onClick={() => settings.rate_source !== src && update.mutate({ rate_source: src }, { onError: errorToast("No se pudo cambiar") })}
          >
            {src === "bcv" ? "Usar tasa BCV" : "Usar tasa propia"}
          </Button>
        ))}
      </div>

      {settings.rate_source === "manual" && (
        <form onSubmit={saveRate} className="grid gap-2 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
          <div className="space-y-1">
            <Label htmlFor="rate-value">Nueva tasa</Label>
            <Input id="rate-value" inputMode="decimal" value={rate} onChange={(e) => setRateText(e.target.value)} placeholder="881,07" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rate-note">Nota</Label>
            <Input id="rate-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opcional" />
          </div>
          <Button type="submit" disabled={setRate.isPending}>
            Fijar
          </Button>
          {history.length > 0 && (
            <ul className="space-y-1 pt-2 text-xs text-muted-foreground sm:col-span-3">
              {history.map((h) => (
                <li key={h.id}>
                  <span className="num font-semibold text-foreground">{fmtRate(h.rate)}</span> · {formatDateTime(h.created_at)}
                  {h.note ? ` · ${h.note}` : ""}
                </li>
              ))}
            </ul>
          )}
        </form>
      )}
      <p className="text-xs text-muted-foreground">
        Cada venta guarda la tasa con la que se cobró: cambiar la tasa no altera ventas pasadas.
      </p>
    </Card>
  );
}

/* ---------------- Impuestos ---------------- */

function TaxSection() {
  const { data: settings } = useTenantSettings();
  const { data: taxes = [] } = useTaxRates();
  const update = useUpdateTenantSettings();
  const save = useSaveTaxRate();
  const setDefault = useSetDefaultTax();
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");
  const [igtf, setIgtf] = useState<string | null>(null);

  if (!settings) return null;

  const add = (event: FormEvent) => {
    event.preventDefault();
    const n = parseAmount(rate);
    if (n == null || Number.isNaN(n) || n < 0 || n > 100) return toast.error("El porcentaje va de 0 a 100");
    save.mutate(
      { name: name.trim(), rate: n },
      {
        onSuccess: () => {
          setName("");
          setRate("");
        },
        onError: errorToast("No se pudo crear"),
      },
    );
  };

  return (
    <Card className="space-y-4 p-4">
      <p className="mono-cap text-xs text-muted-foreground">Impuestos</p>
      <div className="space-y-3">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>
            Los precios ya incluyen el IVA
            <span className="block text-xs text-muted-foreground">Lo normal en tiendas: el precio del cartel es el que paga el cliente.</span>
          </span>
          <Switch checked={settings.prices_include_tax} onCheckedChange={(v) => update.mutate({ prices_include_tax: v }, { onError: errorToast("No se pudo guardar") })} />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>
            Contribuyente especial (cobra IGTF)
            <span className="block text-xs text-muted-foreground">Recargo sobre los pagos en divisas marcados con IGTF.</span>
          </span>
          <Switch checked={settings.is_special_taxpayer} onCheckedChange={(v) => update.mutate({ is_special_taxpayer: v }, { onError: errorToast("No se pudo guardar") })} />
        </label>
        {settings.is_special_taxpayer && (
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="igtf">IGTF %</Label>
              <Input id="igtf" className="w-24" inputMode="decimal" value={igtf ?? String(settings.igtf_rate)} onChange={(e) => setIgtf(e.target.value)} />
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={igtf == null}
              onClick={() => {
                const n = parseAmount(igtf ?? "");
                if (n == null || Number.isNaN(n) || n < 0 || n > 100) return toast.error("El porcentaje va de 0 a 100");
                update.mutate({ igtf_rate: n }, { onSuccess: () => setIgtf(null), onError: errorToast("No se pudo guardar") });
              }}
            >
              Guardar
            </Button>
          </div>
        )}
      </div>

      <ul className="divide-y rounded-lg border">
        {taxes.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
            <span className="flex items-center gap-2">
              <span className="font-semibold">{t.name}</span>
              <span className="num">{t.rate}%</span>
              {t.is_default && <Badge>Por defecto</Badge>}
              {!t.is_active && <Badge variant="outline">Inactivo</Badge>}
            </span>
            <span className="flex items-center gap-2">
              {!t.is_default && (
                <Button size="sm" variant="ghost" onClick={() => setDefault.mutate(t.id, { onError: errorToast("No se pudo cambiar") })}>
                  Usar por defecto
                </Button>
              )}
              {!t.is_default && (
                <Switch checked={t.is_active} aria-label={`Activo ${t.name}`} onCheckedChange={(v) => save.mutate({ id: t.id, is_active: v }, { onError: errorToast("No se pudo guardar") })} />
              )}
            </span>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="tax-name">Nuevo impuesto</Label>
          <Input id="tax-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Impuesto municipal" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="tax-rate">%</Label>
          <Input id="tax-rate" required className="w-24" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </div>
        <Button type="submit" variant="outline" disabled={save.isPending}>
          Agregar
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">Cada producto usa el impuesto por defecto salvo que se le asigne otro.</p>
    </Card>
  );
}

/* ---------------- Métodos de pago ---------------- */

function PaymentMethodsSection() {
  const { data: settings } = useTenantSettings();
  const { data: methods = [] } = usePaymentMethods();
  const save = useSavePaymentMethod();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("");
  const [kind, setKind] = useState<PaymentMethod["kind"]>("other");

  if (!settings) return null;
  const currencies = [settings.base_currency, settings.local_currency].filter((c): c is string => Boolean(c));

  const add = (event: FormEvent) => {
    event.preventDefault();
    const code = slugCode(name);
    if (methods.some((m) => m.code === code)) return toast.error("Ya existe un método con ese nombre");
    save.mutate(
      {
        code,
        name: name.trim(),
        currency: currency || currencies[0],
        kind,
        applies_igtf: (currency || currencies[0]) !== settings.local_currency && kind !== "bnpl",
        position: methods.length + 1,
      },
      {
        onSuccess: () => {
          setName("");
          toast.success("Método creado");
        },
        onError: errorToast("No se pudo crear"),
      },
    );
  };

  return (
    <Card className="space-y-4 p-4">
      <p className="mono-cap text-xs text-muted-foreground">Métodos de pago</p>
      <ul className="divide-y rounded-lg border">
        {methods.map((m) => (
          <li key={m.id} className="space-y-2 px-3 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <span className="font-semibold">{m.name}</span>
                <Badge variant="outline">{m.currency}</Badge>
                <span className="text-xs text-muted-foreground">{KIND_LABEL[m.kind]}</span>
              </span>
              <span className="flex items-center gap-4">
                {settings.is_special_taxpayer && (
                  <label className="flex items-center gap-2 text-xs">
                    <Switch checked={m.applies_igtf} onCheckedChange={(v) => save.mutate({ id: m.id, applies_igtf: v }, { onError: errorToast("No se pudo guardar") })} />
                    IGTF
                  </label>
                )}
                <label className="flex items-center gap-2 text-xs">
                  <Switch checked={m.is_active} onCheckedChange={(v) => save.mutate({ id: m.id, is_active: v }, { onError: errorToast("No se pudo guardar") })} />
                  Activo
                </label>
              </span>
            </div>
            {m.fields.some((f) => f.type === "bank") && <BanksEditor method={m} />}
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="pm-name">Nuevo método</Label>
          <Input id="pm-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Binance Pay" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pm-currency">Moneda</Label>
          <select
            id="pm-currency"
            value={currency || currencies[0]}
            onChange={(e) => setCurrency(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="pm-kind">Tipo</Label>
          <select
            id="pm-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as PaymentMethod["kind"])}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            {Object.entries(KIND_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline" disabled={save.isPending}>
          Agregar
        </Button>
      </form>
    </Card>
  );
}

function BanksEditor({ method }: { method: PaymentMethod }) {
  const save = useSavePaymentMethod();
  const [text, setText] = useState(method.banks.join(", "));
  const commit = () => {
    const banks = Array.from(new Set(text.split(",").map((b) => b.trim()).filter(Boolean)));
    if (banks.join("|") === method.banks.join("|")) return;
    save.mutate({ id: method.id, banks }, { onSuccess: () => toast.success("Bancos guardados"), onError: errorToast("No se pudo guardar") });
  };
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={`banks-${method.id}`} className="shrink-0 text-xs text-muted-foreground">
        Bancos donde recibes
      </Label>
      <Input id={`banks-${method.id}`} className="h-8 text-xs" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} placeholder="Banesco, BNC, Mercantil" />
    </div>
  );
}
