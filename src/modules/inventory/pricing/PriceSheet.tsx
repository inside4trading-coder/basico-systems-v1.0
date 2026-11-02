/**
 * Ficha de precio de una variante: el desglose del costo al PVP sugerido,
 * cómo está el precio vigente, y el historial de cambios. Un precio fijado a
 * mano puede quedar como manual para que la política no lo cambie.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatMoney } from "@/core/money";
import { withTax } from "@/core/tax";
import { usePriceHistory, useSetPrices } from "./api";
import {
  breakEven,
  maxDiscountNoLoss,
  netFromPvp,
  pct,
  PRICE_STATUS_HELP,
  PRICE_STATUS_LABEL,
  profitAt,
  ROUNDING_LABEL,
  suggestPrice,
  type PriceStatus,
  type PricingPolicy,
} from "./pricing";
import { Row } from "./PolicyTab";

export interface PriceRow {
  variantId: string;
  name: string;
  variant: string;
  sku: string | null;
  cost: number | null;
  pricedCost: number | null;
  regular: number | null;
  price: number | null;
  taxRate: number;
  /** Precio manual: la política no lo cambia. */
  locked: boolean;
  status: PriceStatus;
}

export default function PriceSheet({ row, policy, currency, editable, onClose }: {
  row: PriceRow | null;
  policy: PricingPolicy;
  currency: string;
  editable: boolean;
  onClose: () => void;
}) {
  const setPrices = useSetPrices();
  const history = usePriceHistory(row?.variantId ?? null);
  const s = row ? suggestPrice(row.cost, policy, row.taxRate) : null;
  const [pvp, setPvp] = useState("");
  const [keep, setKeep] = useState(true);
  useEffect(() => setPvp(s ? String(s.pvp) : ""), [row?.variantId, s?.pvp]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setKeep(true), [row?.variantId]);

  if (!row) return null;
  const money = (n: number | null) => (n == null ? "—" : formatMoney(n, currency));
  const currentPvp = row.regular == null ? null : withTax(row.regular, row.taxRate);
  const offerPvp = row.price != null && row.regular != null && row.price < row.regular ? withTax(row.price, row.taxRate) : null;
  const current = row.cost && row.regular != null ? profitAt(row.price ?? row.regular, row.cost, policy) : null;
  const minPvp = row.cost ? withTax(Math.ceil(breakEven(row.cost, policy) * 100) / 100, row.taxRate) : null;

  const fix = () => {
    const n = Number(pvp.replace(",", "."));
    if (!(n > 0)) return toast.error("Escribe un PVP válido");
    const net = netFromPvp(n, row.taxRate);
    const fromPolicy = !!s && n === s.pvp;
    const locked = fromPolicy ? false : keep;
    setPrices.mutate(
      { items: [{ variant_id: row.variantId, regular_price: net, price_locked: locked }], reason: fromPolicy ? "Fijación con la política" : "Fijación manual" },
      {
        onSuccess: () => toast.success(`PVP fijado en ${formatMoney(withTax(net, row.taxRate), currency)}${locked ? " (manual)" : ""}`),
        onError: (err) => toast.error("No se pudo fijar", { description: err.message }),
      },
    );
  };

  const backToPolicy = () => {
    if (!s) return;
    setPrices.mutate(
      { items: [{ variant_id: row.variantId, regular_price: s.net, price_locked: false }], reason: "Volver a la política" },
      {
        onSuccess: () => toast.success(`Vuelve a la política: PVP ${formatMoney(s.pvp, currency)}`),
        onError: (err) => toast.error("No se pudo cambiar", { description: err.message }),
      },
    );
  };
  const typedIsPolicy = !!s && Number(pvp.replace(",", ".")) === s.pvp;

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>
            {row.name}
            {row.variant && <span className="text-muted-foreground"> · {row.variant}</span>}
          </SheetTitle>
          <SheetDescription asChild>
            <div className="flex flex-wrap items-center gap-2">
              {row.sku && <span className="mono text-xs">{row.sku}</span>}
              <Badge variant={row.status === "fijado" ? "outline" : "secondary"}>{PRICE_STATUS_LABEL[row.status]}</Badge>
              <span className="text-xs">{PRICE_STATUS_HELP[row.status]}</span>
            </div>
          </SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="fijacion" className="mt-4">
          <TabsList>
            <TabsTrigger value="fijacion">Fijación</TabsTrigger>
            <TabsTrigger value="historial">Historial</TabsTrigger>
          </TabsList>

          <TabsContent value="fijacion" className="space-y-4 text-sm">
            <section className="space-y-1 rounded-surface border p-3">
              <h3 className="mono-cap text-xs text-muted-foreground">A · Costo</h3>
              <Row label="Costo del producto" value={money(row.cost)} />
              {s && <Row label={`Gastos de traída (${pct(policy.overhead_pct)} %)`} value={money(s.overhead)} />}
              {s && <Row label="Costo total" value={money(s.landed)} strong />}
              {row.status === "revisar" && row.pricedCost != null && (
                <p className="text-xs text-destructive">Cuando se fijó el precio el costo era {money(row.pricedCost)}.</p>
              )}
            </section>

            {s ? (
              <section className="space-y-1 rounded-surface border p-3">
                <h3 className="mono-cap text-xs text-muted-foreground">B · Formación del precio</h3>
                <Row label={`Ganancia objetivo (${pct(policy.target_margin)} %)`} value={money(s.profit)} />
                {s.replacement > 0 && <Row label={`Ajuste por reposición (${pct(policy.replacement_pct)} %)`} value={money(s.replacement)} />}
                {s.concepts.map((c, i) => (
                  <Row key={i} label={`${c.name} (${pct(c.pct)} %)`} value={money(c.amount)} />
                ))}
                {s.net !== s.rawNet && <Row label="Redondeo del PVP" value={money(Math.round((s.net - s.rawNet) * 100) / 100)} />}
                <Row label="Precio sin IVA" value={money(s.net)} strong />
                <Row label={`IVA (${pct(row.taxRate)} %)`} value={money(s.tax)} />
                <div className="flex items-baseline justify-between border-t pt-2">
                  <span>
                    PVP sugerido
                    <span className="block text-xs text-muted-foreground">{ROUNDING_LABEL[policy.rounding]}</span>
                  </span>
                  <span className="num text-2xl font-semibold text-primary">{money(s.pvp)}</span>
                </div>
              </section>
            ) : (
              <p className="text-muted-foreground">Carga el costo del producto para ver el precio sugerido.</p>
            )}

            <section className="space-y-1 rounded-surface border p-3">
              <h3 className="mono-cap text-xs text-muted-foreground">C · Precio vigente</h3>
              <Row label="PVP actual" value={money(currentPvp)} />
              {offerPvp != null && <Row label="PVP en oferta" value={money(offerPvp)} />}
              {current && <Row label="Ganancia real" value={`${money(current.amount)} · ${pct(current.pct)} %`} />}
              {minPvp != null && Number.isFinite(minPvp) && <Row label="PVP mínimo sin pérdida" value={money(minPvp)} />}
              {row.cost != null && row.regular != null && (
                <Row label="Descuento máximo sin pérdida" value={`${pct(maxDiscountNoLoss(row.regular, row.cost, policy))} %`} />
              )}
            </section>

            {editable && (
              <div className="space-y-2">
                {row.locked && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted p-3 text-xs">
                    <span>Precio manual: la política no lo cambia.</span>
                    {s && (
                      <Button size="sm" variant="outline" onClick={backToPolicy} disabled={setPrices.isPending}>
                        Volver a la política
                      </Button>
                    )}
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <div className="flex-1 space-y-1">
                    <label htmlFor="pvp-fix" className="text-xs text-muted-foreground">PVP a fijar (con IVA)</label>
                    <Input id="pvp-fix" inputMode="decimal" value={pvp} onChange={(e) => setPvp(e.target.value)} className="text-right" />
                  </div>
                  <Button onClick={fix} disabled={setPrices.isPending}>
                    Fijar precio
                  </Button>
                </div>
                {!typedIsPolicy && (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox checked={keep} onCheckedChange={(v) => setKeep(v === true)} />
                    Mantener este precio: la política no lo cambia
                  </label>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="historial">
            {history.isLoading ? (
              <p className="mono-cap text-xs text-muted-foreground">Cargando…</p>
            ) : (history.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin cambios registrados.</p>
            ) : (
              <ul className="divide-y text-sm">
                {(history.data ?? []).map((h) => (
                  <li key={h.id} className="space-y-0.5 py-2">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">{h.reason}</span>
                      <span className="text-xs text-muted-foreground">{new Date(h.created_at).toLocaleString("es-VE")}</span>
                    </div>
                    <p className="num text-xs text-muted-foreground">
                      Costo {money(h.cost)} · PVP {money(h.regular_price == null ? null : withTax(h.regular_price, row.taxRate))}
                      {h.price != null && h.regular_price != null && h.price < h.regular_price && ` · oferta ${money(withTax(h.price, row.taxRate))}`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
