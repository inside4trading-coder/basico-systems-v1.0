/**
 * Agregar un concepto que no viene del inventario: mano de obra, instalación
 * o un producto que no está cargado. Portado de PosManualItemDialog
 * (basicosystems@f551478b). El precio se escribe en dólares o en bolívares
 * (se convierte con la tasa vigente) y no descuenta stock.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTaxRates } from "@/modules/settings/api";
import { formatMoney, round2, type CartLine, type ManualKind, type MoneySettings } from "./cart";
import { parseAmount } from "./usePosMoney";

const KINDS: { id: ManualKind; label: string }[] = [
  { id: "servicio", label: "Servicio" },
  { id: "producto", label: "Producto" },
  { id: "extra", label: "Extra" },
];

export default function ManualItemDialog({
  open,
  onOpenChange,
  money,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  money: MoneySettings | null;
  onAdd: (line: CartLine) => void;
}) {
  const { data: taxRates = [] } = useTaxRates();
  const active = taxRates.filter((t) => t.is_active);
  const base = money?.baseCurrency ?? "USD";
  const local = money?.localCurrency && money.rate ? money.localCurrency : null;
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ManualKind>("servicio");
  const [currency, setCurrency] = useState(base);
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("1");
  const [taxId, setTaxId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setKind("servicio");
    setCurrency(base);
    setPrice("");
    setQty("1");
    setTaxId(null);
    setError(null);
  }, [open, base]);

  const tax = active.find((t) => t.id === taxId) ?? active.find((t) => t.is_default) ?? null;
  const value = parseAmount(price);
  const priceBase = currency === base ? round2(value) : money?.rate ? round2(value / money.rate) : 0;

  const submit = () => {
    if (!name.trim()) return setError("Escribe qué se cobra.");
    if (!(priceBase > 0)) return setError("Indica un precio mayor que cero.");
    const q = Math.max(1, Math.round(parseAmount(qty) || 1));
    onAdd({
      variantId: `manual-${crypto.randomUUID()}`,
      productId: "",
      name: name.trim().slice(0, 120),
      options: {},
      sku: null,
      unit: "unidad",
      price: priceBase,
      taxRate: tax?.rate ?? 0,
      qty: q,
      discount: 0,
      available: null,
      manual: { kind, taxRateId: taxId },
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Agregar concepto</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">Para lo que no está en el inventario: no descuenta stock.</p>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="mi-name">Descripción</Label>
            <Input id="mi-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Mano de obra, instalación…" autoFocus />
          </div>
          <div className="flex gap-1" role="group" aria-label="Tipo">
            {KINDS.map((k) => (
              <Button key={k.id} type="button" size="sm" variant={kind === k.id ? "default" : "outline"} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
                {k.label}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="mi-price">Precio unitario</Label>
              <Input id="mi-price" inputMode="decimal" className="num" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div className="flex gap-1">
              {[base, ...(local ? [local] : [])].map((c) => (
                <Button key={c} type="button" size="sm" variant={currency === c ? "default" : "outline"} onClick={() => setCurrency(c)}>
                  {c}
                </Button>
              ))}
            </div>
          </div>
          {currency !== base && priceBase > 0 && <p className="text-xs text-muted-foreground">Equivale a {formatMoney(priceBase, base)}</p>}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="mi-qty">Cantidad</Label>
              <Input id="mi-qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Impuesto</Label>
              <Select value={tax?.id ?? ""} onValueChange={(v) => setTaxId(v)}>
                <SelectTrigger aria-label="Impuesto">
                  <SelectValue placeholder="Sin impuesto" />
                </SelectTrigger>
                <SelectContent>
                  {active.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} ({t.rate} %)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button className="h-11 w-full" onClick={submit}>
            Agregar al carrito
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
