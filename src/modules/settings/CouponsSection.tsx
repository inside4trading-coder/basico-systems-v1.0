/**
 * Cupones de descuento para el POS: código, porcentaje o monto, vigencia,
 * compra mínima y usos máximos. Los usos se cuentan sobre ventas no anuladas.
 */
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { currencySymbol, formatMoney } from "@/core/money";
import { useTenant } from "@/core/tenant-context";
import { isValidCouponCode, normalizeCouponCode } from "@/modules/pos/coupons";
import { useCouponUsage, useCoupons, useSaveCoupon, type Coupon } from "./couponsApi";

const EMPTY = { code: "", description: "", kind: "percent" as Coupon["kind"], value: "", minPurchase: "", startsOn: "", endsOn: "", maxUses: "" };

const num = (v: string) => {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

export default function CouponsSection() {
  const base = useTenant().active?.tenant.base_currency ?? "USD";
  const { data: coupons = [] } = useCoupons();
  const { data: usage = [] } = useCouponUsage();
  const save = useSaveCoupon();
  const [form, setForm] = useState(EMPTY);
  const [open, setOpen] = useState(false);
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const fail = (err: Error) => toast.error("No se pudo guardar", { description: err.message });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const code = normalizeCouponCode(form.code);
    if (!isValidCouponCode(code)) return toast.error("Código de 3 a 24 letras, números, guiones");
    const value = num(form.value);
    if (!(value > 0) || (form.kind === "percent" && value > 100)) return toast.error(form.kind === "percent" ? "El porcentaje va de 0 a 100" : "El monto debe ser mayor que cero");
    const minPurchase = form.minPurchase ? num(form.minPurchase) : 0;
    const maxUses = form.maxUses ? Math.trunc(num(form.maxUses)) : null;
    if (!(minPurchase >= 0) || (maxUses !== null && !(maxUses > 0))) return toast.error("Revisa la compra mínima y los usos");
    if (form.startsOn && form.endsOn && form.endsOn < form.startsOn) return toast.error("La fecha final va después de la inicial");
    save.mutate(
      {
        code,
        description: form.description.trim() || null,
        kind: form.kind,
        value,
        min_purchase: minPurchase,
        starts_on: form.startsOn || null,
        ends_on: form.endsOn || null,
        max_uses: maxUses,
      },
      {
        onSuccess: () => {
          toast.success(`Cupón ${code} creado`);
          setForm(EMPTY);
          setOpen(false);
        },
        onError: fail,
      },
    );
  };

  const describe = (c: Coupon) =>
    [
      c.kind === "percent" ? `${c.value.toLocaleString("es-VE")} %` : formatMoney(c.value, base),
      c.min_purchase > 0 ? `desde ${formatMoney(c.min_purchase, base)}` : null,
      c.starts_on || c.ends_on ? `${c.starts_on ?? "…"} a ${c.ends_on ?? "…"}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="mono-cap text-xs text-muted-foreground">Cupones</p>
          <p className="text-sm text-muted-foreground">Descuentos con código para el POS. El cajero los aplica con «Cupón».</p>
        </div>
        {!open && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Nuevo cupón
          </Button>
        )}
      </div>

      {open && (
        <form onSubmit={submit} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="cp-code">Código</Label>
            <Input id="cp-code" value={form.code} onChange={set("code")} placeholder="NAVIDAD" className="uppercase" autoFocus />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cp-desc">Descripción (opcional)</Label>
            <Input id="cp-desc" value={form.description} onChange={set("description")} maxLength={120} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cp-value">Descuento</Label>
            <div className="flex gap-1">
              <Input id="cp-value" inputMode="decimal" value={form.value} onChange={set("value")} className="num" placeholder="10" />
              {(["percent", "amount"] as const).map((k) => (
                <Button key={k} type="button" variant={form.kind === k ? "default" : "outline"} onClick={() => setForm((f) => ({ ...f, kind: k }))}>
                  {k === "percent" ? "%" : currencySymbol(base)}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cp-min">Compra mínima en {currencySymbol(base)} (opcional)</Label>
            <Input id="cp-min" inputMode="decimal" value={form.minPurchase} onChange={set("minPurchase")} className="num" placeholder="0" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cp-from">Desde (opcional)</Label>
            <Input id="cp-from" type="date" value={form.startsOn} onChange={set("startsOn")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cp-to">Hasta (opcional)</Label>
            <Input id="cp-to" type="date" value={form.endsOn} onChange={set("endsOn")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cp-uses">Usos máximos (opcional)</Label>
            <Input id="cp-uses" inputMode="numeric" value={form.maxUses} onChange={set("maxUses")} className="num" placeholder="Sin límite" />
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit" disabled={save.isPending}>
              Crear cupón
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {coupons.length === 0 && !open && <p className="text-sm text-muted-foreground">Aún no hay cupones.</p>}
      <ul className="space-y-2">
        {coupons.map((c) => {
          const u = usage.find((x) => x.coupon_id === c.id);
          return (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2">
              <div className="min-w-0">
                <p className="mono text-sm font-semibold">{c.code}</p>
                <p className="text-xs text-muted-foreground">
                  {describe(c)}
                  {c.description ? ` · ${c.description}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="num text-xs text-muted-foreground">
                  {u?.uses ?? 0}
                  {c.max_uses ? ` / ${c.max_uses}` : ""} {(u?.uses ?? 0) === 1 && !c.max_uses ? "uso" : "usos"}
                  {u && u.discount_total > 0 ? ` · ${formatMoney(Number(u.discount_total), base)}` : ""}
                </span>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Switch checked={c.is_active} onCheckedChange={(v) => save.mutate({ id: c.id, is_active: v }, { onError: fail })} />
                  {c.is_active ? "Activo" : "Inactivo"}
                </label>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
