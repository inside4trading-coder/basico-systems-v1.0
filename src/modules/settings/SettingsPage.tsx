/**
 * Configuración del negocio para cobrar: tasa de cambio, impuestos y métodos
 * de pago (la tasa vive en RateSection). Reemplaza la pantalla TasaBCV de Sublime y la lista fija de
 * posPaymentMethods.ts (basicosystems@f551478b).
 */
import { useState, type FormEvent } from "react";
import { useHashScroll } from "@/lib/useHashScroll";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTenant } from "@/core/tenant-context";
import BusinessSection from "./BusinessSection";
import CashiersSection from "./CashiersSection";
import ChannelsSection from "./ChannelsSection";
import CouponsSection from "./CouponsSection";
import ClosingReminderSection from "./ClosingReminderSection";
import ExportSection from "./ExportSection";
import PlanSection from "./PlanSection";
import RateSection from "./RateSection";
import { parseAmount } from "@/modules/inventory/import/preview";
import {
  slugCode,
  usePaymentMethods,
  useSavePaymentMethod,
  useSaveTaxRate,
  useSetDefaultTax,
  useTaxRates,
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

const errorToast = (title: string) => (err: Error) => toast.error(title, { description: err.message });

export default function SettingsPage() {
  const { can } = useTenant();
  useHashScroll();
  if (!(can("config.negocio") || can("caja.cupones") || can("caja.cajeros"))) return <Navigate to="/" replace />;
  // Cada sección tiene un id: el menú lateral lleva directo a ella (/configuracion#tasa).
  const section = (id: string, node: React.ReactNode) => (
    <div id={id} className="scroll-mt-4">
      {node}
    </div>
  );
  return (
    <AppShell>
      <h1 className="text-2xl">Configuración</h1>
      {can("config.negocio") && section("negocio", <BusinessSection />)}
      {can("config.negocio") && (
        <>
          {section("tasa", <RateSection />)}
          {section("impuestos", <TaxSection />)}
          {section("pagos", <PaymentMethodsSection />)}
        </>
      )}
      {can("caja.cajeros") && section("cajeros", <CashiersSection />)}
      {can("config.negocio") && section("canales", <ChannelsSection />)}
      {can("caja.cupones") && section("cupones", <CouponsSection />)}
      {can("config.negocio") && section("cierre", <ClosingReminderSection />)}
      {can("config.negocio") && section("plan", <PlanSection />)}
      {can("config.negocio") && section("exportar", <ExportSection />)}
    </AppShell>
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
        <p className="text-xs text-muted-foreground">
          Los precios se cargan sin IVA. La app suma el IVA de cada producto (el de por defecto si no tiene uno), muestra el PVP y
          guarda el IVA de cada venta para el reporte de IVA.
        </p>
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
