import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateProduct, type NewVariantInput } from "./api";
import { formatMoney, parseOptions } from "./lib";
import { productTaxRate, withTax } from "@/core/tax";
import { useTaxRates } from "@/modules/settings/api";

interface VariantDraft {
  options: string;
  sku: string;
  barcode: string;
  regularPrice: string;
  price: string;
  cost: string;
}

const emptyVariant = (): VariantDraft => ({ options: "", sku: "", barcode: "", regularPrice: "", price: "", cost: "" });

function toNumber(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

export default function NewProductDialog({ open, onOpenChange, currency }: { open: boolean; onOpenChange: (v: boolean) => void; currency: string }) {
  const create = useCreateProduct();
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  const [unit, setUnit] = useState("unidad");
  const [taxRateId, setTaxRateId] = useState("");
  const { data: taxes = [] } = useTaxRates();
  const [variants, setVariants] = useState<VariantDraft[]>([emptyVariant()]);
  const multi = variants.length > 1;

  const reset = () => {
    setName("");
    setBrand("");
    setCategory("");
    setUnit("unidad");
    setTaxRateId("");
    setVariants([emptyVariant()]);
  };

  const update = (i: number, patch: Partial<VariantDraft>) =>
    setVariants((list) => list.map((v, j) => (j === i ? { ...v, ...patch } : v)));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed: NewVariantInput[] = [];
    for (const v of variants) {
      const regularPrice = toNumber(v.regularPrice);
      const price = toNumber(v.price);
      const cost = toNumber(v.cost);
      if ([regularPrice, price, cost].some((n) => Number.isNaN(n))) {
        toast.error("Revisa los montos: solo números positivos");
        return;
      }
      const options = parseOptions(v.options);
      if (multi && Object.keys(options).length === 0) {
        toast.error("Con varias variantes, cada una necesita sus opciones (p. ej. Talla: M)");
        return;
      }
      parsed.push({ options, sku: v.sku, barcode: v.barcode, regularPrice, price, cost });
    }

    create.mutate(
      { name, brand, category, unit, taxRateId: taxRateId || null, variants: parsed },
      {
        onSuccess: () => {
          toast.success("Producto creado");
          reset();
          onOpenChange(false);
        },
        onError: (err) => toast.error("No se pudo crear", { description: err.message }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nuevo producto</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="np-name">Nombre</Label>
              <Input id="np-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="np-brand">Marca</Label>
              <Input id="np-brand" value={brand} onChange={(e) => setBrand(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="np-category">Categoría</Label>
              <Input id="np-category" value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="np-unit">Se vende por</Label>
              <Input id="np-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="unidad, metro, kilo…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="np-tax">Impuesto</Label>
              <select
                id="np-tax"
                value={taxRateId}
                onChange={(e) => setTaxRateId(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Por defecto{taxes.find((t) => t.is_default) ? ` (${taxes.find((t) => t.is_default)!.name})` : ""}</option>
                {taxes
                  .filter((t) => t.is_active && !t.is_default)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} · {t.rate}%
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div className="space-y-3">
            <p className="mono-cap text-xs text-muted-foreground">
              {multi ? `${variants.length} variantes` : "Precio y códigos"} · montos en {currency}, sin IVA
            </p>
            {variants.map((v, i) => (
              <div key={i} className="space-y-2 rounded-lg border p-3">
                {multi && (
                  <div className="flex items-end gap-2">
                    <div className="flex-1 space-y-1.5">
                      <Label htmlFor={`np-opt-${i}`}>Opciones</Label>
                      <Input
                        id={`np-opt-${i}`}
                        value={v.options}
                        onChange={(e) => update(i, { options: e.target.value })}
                        placeholder="Talla: M, Color: Rojo"
                      />
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label="Quitar variante"
                      onClick={() => setVariants((list) => list.filter((_, j) => j !== i))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <div className="space-y-1">
                    <Label className="text-[11px]" htmlFor={`np-sku-${i}`}>SKU</Label>
                    <Input id={`np-sku-${i}`} value={v.sku} onChange={(e) => update(i, { sku: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]" htmlFor={`np-bc-${i}`}>Código de barras</Label>
                    <Input id={`np-bc-${i}`} value={v.barcode} onChange={(e) => update(i, { barcode: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]" htmlFor={`np-rp-${i}`}>Precio sin IVA</Label>
                    <Input id={`np-rp-${i}`} inputMode="decimal" value={v.regularPrice} onChange={(e) => update(i, { regularPrice: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]" htmlFor={`np-p-${i}`}>Oferta sin IVA</Label>
                    <Input id={`np-p-${i}`} inputMode="decimal" value={v.price} onChange={(e) => update(i, { price: e.target.value })} placeholder="—" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]" htmlFor={`np-c-${i}`}>Costo</Label>
                    <Input id={`np-c-${i}`} inputMode="decimal" value={v.cost} onChange={(e) => update(i, { cost: e.target.value })} />
                  </div>
                </div>
                <PvpHint
                  net={toNumber(v.price) ?? toNumber(v.regularPrice)}
                  rate={productTaxRate(taxRateId || null, taxes)}
                  currency={currency}
                />
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setVariants((list) => [...list, emptyVariant()])}>
              <Plus /> Agregar variante
            </Button>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Creando…" : "Crear producto"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** PVP que verá el cliente (precio u oferta más el IVA elegido). */
function PvpHint({ net, rate, currency }: { net: number | null; rate: number; currency: string }) {
  if (net == null || Number.isNaN(net)) return null;
  return (
    <p className="text-xs text-muted-foreground">
      PVP con IVA ({rate}%):{" "}
      <b className="num text-foreground">{formatMoney(withTax(net, rate), currency)}</b>
    </p>
  );
}
