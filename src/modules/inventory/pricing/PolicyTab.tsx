/**
 * Política de precios del negocio: ganancia objetivo, gastos de traída,
 * comisiones que se descuentan de cada venta, ganancia mínima y redondeo.
 * Muestra en vivo cómo queda un precio de ejemplo. Al guardar ofrece aplicarla
 * a todo el inventario.
 */
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { formatMoney } from "@/core/money";
import { useOfficialRateChange, useSavePricingPolicy } from "./api";
import ApplyPolicyDialog from "./ApplyPolicyDialog";
import { feesRate, pct, ROUNDING_LABEL, suggestPrice, type PricingPolicy, type Rounding } from "./pricing";

const num = (v: string) => {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

/** Campo numérico que deja escribir decimales («1,» o «1.5») sin perder lo tecleado. */
function DecimalInput({ value, onChange, ...rest }: Omit<React.ComponentProps<typeof Input>, "value" | "onChange"> & {
  value: number;
  onChange: (n: number) => void;
}) {
  const [text, setText] = useState(String(value).replace(".", ","));
  useEffect(() => {
    if (num(text) !== value) setText(String(value).replace(".", ","));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Input
      {...rest}
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        const t = e.target.value.replace(/[^0-9.,]/g, "");
        setText(t);
        onChange(num(t));
      }}
    />
  );
}

function PctField({ id, label, help, value, onChange, disabled }: {
  id: string;
  label: string;
  help: string;
  value: number;
  onChange: (n: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <DecimalInput id={id} className="w-28 text-right" value={value} disabled={disabled} onChange={onChange} />
        <span className="text-sm text-muted-foreground">%</span>
      </div>
      <p className="text-xs text-muted-foreground">{help}</p>
    </div>
  );
}

export default function PolicyTab({ policy, editable, currency, taxRate }: {
  policy: PricingPolicy;
  editable: boolean;
  currency: string;
  taxRate: number;
}) {
  const [draft, setDraft] = useState<PricingPolicy>(policy);
  const save = useSavePricingPolicy();
  const [applyOpen, setApplyOpen] = useState(false);
  const { data: rateChange } = useOfficialRateChange();
  useEffect(() => setDraft(policy), [policy]);

  const set = <K extends keyof PricingPolicy>(key: K, value: PricingPolicy[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setConcept = (i: number, patch: Partial<PricingPolicy["concepts"][number]>) =>
    setDraft((d) => ({ ...d, concepts: d.concepts.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));

  const fees = Math.round(feesRate(draft) * 1000) / 10;
  const example = suggestPrice(10, draft, taxRate);
  const invalid = fees >= 90 || draft.concepts.some((c) => !c.name.trim());

  const submit = () =>
    save.mutate(
      { ...draft, concepts: draft.concepts.map((c) => ({ ...c, name: c.name.trim() })) },
      {
        onSuccess: () => {
          toast.success("Política guardada");
          setApplyOpen(true);
        },
        onError: (err) => toast.error("No se pudo guardar", { description: err.message }),
      },
    );

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <Card className="space-y-4 rounded-surface p-4">
          <h2 className="mono-cap text-xs text-muted-foreground">Ganancia</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <PctField id="margin" label="Ganancia objetivo" value={draft.target_margin} disabled={!editable}
              onChange={(n) => set("target_margin", n)} help="Sobre el costo total. 50 % = el costo más la mitad." />
            <PctField id="overhead" label="Gastos de traída" value={draft.overhead_pct} disabled={!editable}
              onChange={(n) => set("overhead_pct", n)} help="Envío, fletes y otros gastos, como % del costo." />
            <PctField id="replacement" label="Ajuste por reposición" value={draft.replacement_pct} disabled={!editable}
              onChange={(n) => set("replacement_pct", n)} help="Opcional. Lo que sumas para reponer la mercancía más cara. En 0 no aplica." />
            <PctField id="min" label="Ganancia mínima" value={draft.min_margin} disabled={!editable}
              onChange={(n) => set("min_margin", n)} help="Por debajo, el precio se marca «Margen bajo»." />
          </div>
          {rateChange && (
            <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
              Referencia: la tasa oficial pasó de {rateChange.from.toLocaleString("es-VE", { maximumFractionDigits: 2 })} a{" "}
              {rateChange.to.toLocaleString("es-VE", { maximumFractionDigits: 2 })} entre el{" "}
              {new Date(`${rateChange.fromDate}T12:00:00`).toLocaleDateString("es-VE")} y el {new Date(`${rateChange.toDate}T12:00:00`).toLocaleDateString("es-VE")} (
              {rateChange.pct > 0 ? "+" : ""}
              {pct(rateChange.pct)} %). Solo informa: el ajuste por reposición lo decides tú y la app no lo cambia sola.
            </p>
          )}
        </Card>

        <Card className="space-y-3 rounded-surface p-4">
          <div>
            <h2 className="mono-cap text-xs text-muted-foreground">Comisiones sobre la venta</h2>
            <p className="text-xs text-muted-foreground">
              Lo que se descuenta de cada venta: vendedor, punto de venta, financiadora, impuestos municipales. El IVA no va aquí: se
              suma aparte al PVP.
            </p>
          </div>
          {draft.concepts.length === 0 && <p className="text-sm text-muted-foreground">Sin comisiones.</p>}
          {draft.concepts.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <Switch checked={c.active} disabled={!editable} onCheckedChange={(v) => setConcept(i, { active: v })} aria-label={`Activar ${c.name}`} />
              <Input value={c.name} placeholder="Nombre" maxLength={40} disabled={!editable} className="flex-1"
                onChange={(e) => setConcept(i, { name: e.target.value })} aria-label="Nombre de la comisión" />
              <DecimalInput value={c.pct} disabled={!editable} className="w-20 text-right"
                onChange={(n) => setConcept(i, { pct: n })} aria-label="Porcentaje" />
              <span className="text-sm text-muted-foreground">%</span>
              {editable && (
                <Button variant="ghost" size="icon" aria-label={`Quitar ${c.name || "comisión"}`}
                  onClick={() => setDraft((d) => ({ ...d, concepts: d.concepts.filter((_, j) => j !== i) }))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {editable && draft.concepts.length < 20 && (
              <Button variant="outline" size="sm"
                onClick={() => setDraft((d) => ({ ...d, concepts: [...d.concepts, { name: "", pct: 0, active: true }] }))}>
                <Plus /> Agregar comisión
              </Button>
            )}
            <p className={`text-sm ${fees >= 90 ? "text-destructive" : "text-muted-foreground"}`}>Activas: {pct(fees)} %</p>
          </div>
        </Card>

        <Card className="space-y-2 rounded-surface p-4">
          <h2 className="mono-cap text-xs text-muted-foreground">Redondeo del PVP</h2>
          <Select value={draft.rounding} onValueChange={(v) => set("rounding", v as Rounding)} disabled={!editable}>
            <SelectTrigger className="w-60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ROUNDING_LABEL) as Rounding[]).map((r) => (
                <SelectItem key={r} value={r}>
                  {ROUNDING_LABEL[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Siempre hacia arriba: el redondeo nunca baja el precio calculado.</p>
        </Card>

        <Card className="flex items-start justify-between gap-4 rounded-surface p-4">
          <div className="space-y-1">
            <Label htmlFor="auto-on-cost">Actualizar el precio cuando cambie el costo</Label>
            <p className="text-xs text-muted-foreground">
              Al cargar o cambiar el costo de un producto, su precio pasa a ser el de la política. Los precios manuales no se tocan.
              Apagado, el producto queda en «Revisar».
            </p>
          </div>
          <Switch id="auto-on-cost" checked={draft.auto_on_cost} disabled={!editable} onCheckedChange={(v) => set("auto_on_cost", v)} />
        </Card>

        {editable && (
          <div className="flex justify-end">
            <Button onClick={submit} disabled={save.isPending || invalid}>
              Guardar política
            </Button>
          </div>
        )}
      </div>

      <ApplyPolicyDialog open={applyOpen} onOpenChange={setApplyOpen} title="¿Aplicar la política a todo el inventario?" />

      <Card className="h-fit space-y-2 rounded-surface p-4 text-sm">
        <h2 className="mono-cap text-xs text-muted-foreground">Ejemplo con costo {formatMoney(10, currency)}</h2>
        {example ? (
          <>
            <Row label="Costo total" value={formatMoney(example.landed, currency)} />
            <Row label={`Ganancia (${pct(draft.target_margin)} %)`} value={formatMoney(example.profit, currency)} />
            {example.replacement > 0 && (
              <Row label={`Reposición (${pct(draft.replacement_pct)} %)`} value={formatMoney(example.replacement, currency)} />
            )}
            {example.concepts.map((c, i) => (
              <Row key={i} label={`${c.name || "Comisión"} (${pct(c.pct)} %)`} value={formatMoney(c.amount, currency)} />
            ))}
            {example.net !== example.rawNet && (
              <Row label="Redondeo del PVP" value={formatMoney(Math.round((example.net - example.rawNet) * 100) / 100, currency)} />
            )}
            <Row label="Precio sin IVA" value={formatMoney(example.net, currency)} strong />
            <Row label={`IVA (${pct(taxRate)} %)`} value={formatMoney(example.tax, currency)} />
            <div className="flex items-baseline justify-between border-t pt-2">
              <span>PVP</span>
              <span className="num text-xl font-semibold text-primary">{formatMoney(example.pvp, currency)}</span>
            </div>
          </>
        ) : (
          <p className="text-destructive">Las comisiones suman 90 % o más: no hay precio posible.</p>
        )}
      </Card>
    </div>
  );
}

export function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${strong ? "font-semibold" : ""}`}>
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}
