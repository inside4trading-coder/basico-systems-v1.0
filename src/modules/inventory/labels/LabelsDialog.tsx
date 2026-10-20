/**
 * Imprimir etiquetas de precio con código de barras: se buscan productos, se
 * indica cuántas de cada uno y se imprime en rollo térmico u hoja carta.
 */
import { useEffect, useState } from "react";
import JsBarcode from "jsbarcode";
import { Minus, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/core/supabase";
import { formatMoney } from "@/modules/pos/cart";
import { printReceipt } from "@/modules/pos/receipt";
import { productTaxRate, withTax } from "@/core/tax";
import { useCurrentRate, useTaxRates, useTenantSettings } from "@/modules/settings/api";
import { LABEL_FORMAT_LABEL, expandLabels, labelsHtml, type LabelFormat, type LabelItem } from "./labels";

interface Hit {
  variant_id: string;
  product_name: string;
  options: Record<string, string> | null;
  brand: string | null;
  sku: string | null;
  price: number | null;
}

interface Row {
  hit: Hit;
  copies: number;
}

function barcodeSvg(code: string): string {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  JsBarcode(svg, code, { format: "CODE128", displayValue: true, fontSize: 12, height: 40, margin: 0, width: 1.4 });
  return svg.outerHTML;
}

export default function LabelsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data: settings } = useTenantSettings();
  const { data: rate } = useCurrentRate();
  const { data: taxRates = [] } = useTaxRates();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [format, setFormat] = useState<LabelFormat>("thermal");
  const [showLocal, setShowLocal] = useState(false);
  const [busy, setBusy] = useState(false);
  const base = settings?.base_currency ?? "USD";
  const local = settings?.local_currency ?? null;

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return setHits([]);
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc("catalog_lookup", { p_query: q, p_limit: 12 });
      if (!error) setHits((data ?? []) as Hit[]);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const add = (hit: Hit) => {
    setRows((r) => (r.some((x) => x.hit.variant_id === hit.variant_id) ? r : [...r, { hit, copies: 1 }]));
    setQuery("");
    setHits([]);
  };
  const setCopies = (id: string, copies: number) =>
    setRows((r) => r.map((x) => (x.hit.variant_id === id ? { ...x, copies: Math.max(1, Math.min(200, copies)) } : x)));
  const total = rows.reduce((a, r) => a + r.copies, 0);

  const print = async () => {
    setBusy(true);
    try {
      const ids = rows.map((r) => r.hit.variant_id);
      const { data: codes, error } = await supabase.from("product_codes").select("variant_id, code").eq("kind", "barcode").in("variant_id", ids);
      if (error) throw new Error(error.message);
      const byVariant = new Map((codes ?? []).map((c) => [c.variant_id as string, c.code as string]));
      // La etiqueta lleva el PVP: el precio sin IVA más el IVA del producto.
      const { data: taxOf, error: taxError } = await supabase.from("variants").select("id, products(tax_rate_id)").in("id", ids);
      if (taxError) throw new Error(taxError.message);
      const taxIdByVariant = new Map(
        (taxOf ?? []).map((v) => [v.id as string, (v.products as unknown as { tax_rate_id: string | null } | null)?.tax_rate_id ?? null]),
      );
      const missing: string[] = [];
      const items = rows.flatMap((r) => {
        const code = byVariant.get(r.hit.variant_id) ?? r.hit.sku;
        if (!code) {
          missing.push(r.hit.product_name);
          return [];
        }
        const net = Number(r.hit.price ?? 0);
        const price = settings?.prices_include_tax ? net : withTax(net, productTaxRate(taxIdByVariant.get(r.hit.variant_id), taxRates));
        const item: LabelItem = {
          name: r.hit.product_name,
          detail: [Object.values(r.hit.options ?? {}).join(" · "), r.hit.brand].filter(Boolean).join(" · ") || null,
          code,
          price: price > 0 ? formatMoney(price, base) : "",
          priceLocal: showLocal && local && rate?.rate && price > 0 ? formatMoney(price * rate.rate, local) : null,
          barcodeSvg: barcodeSvg(code),
        };
        return [{ item, copies: r.copies }];
      });
      if (missing.length) toast.warning("Sin código ni SKU, no se imprimen", { description: missing.join(", ") });
      if (items.length) printReceipt(labelsHtml(expandLabels(items), format));
    } catch (err) {
      toast.error("No se pudieron armar las etiquetas", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Etiquetas de precio</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">Con el código de barras del producto (o su SKU) y el precio de venta.</p>
        <div className="space-y-1">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar producto por nombre, código o SKU" aria-label="Buscar producto" />
          {hits.length > 0 && (
            <ul className="max-h-48 space-y-1 overflow-y-auto">
              {hits.map((h) => (
                <li key={h.variant_id}>
                  <button type="button" className="w-full rounded-lg border p-2 text-left text-sm hover:border-primary/50" onClick={() => add(h)}>
                    <span className="font-semibold">{h.product_name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {[Object.values(h.options ?? {}).join(" · "), h.sku].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.hit.variant_id} className="flex items-center gap-2 rounded-lg border p-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{r.hit.product_name}</span>
              <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Menos" onClick={() => setCopies(r.hit.variant_id, r.copies - 1)}>
                <Minus className="h-3 w-3" />
              </Button>
              <Input
                className="num h-8 w-14 text-center"
                inputMode="numeric"
                aria-label={`Etiquetas de ${r.hit.product_name}`}
                value={r.copies}
                onChange={(e) => setCopies(r.hit.variant_id, Number(e.target.value) || 1)}
              />
              <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Más" onClick={() => setCopies(r.hit.variant_id, r.copies + 1)}>
                <Plus className="h-3 w-3" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Quitar" onClick={() => setRows((x) => x.filter((y) => y.hit.variant_id !== r.hit.variant_id))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
        {rows.length === 0 && <p className="text-sm text-muted-foreground">Busca y agrega los productos a etiquetar.</p>}

        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(LABEL_FORMAT_LABEL) as LabelFormat[]).map((f) => (
            <Button key={f} type="button" size="sm" variant={format === f ? "default" : "outline"} onClick={() => setFormat(f)}>
              {LABEL_FORMAT_LABEL[f]}
            </Button>
          ))}
          {local && (
            <label className="ml-auto flex items-center gap-2 text-xs">
              <Switch checked={showLocal} onCheckedChange={setShowLocal} />
              Precio en {local} también
            </label>
          )}
        </div>
        <Button className="h-11 w-full" disabled={rows.length === 0 || busy} onClick={print}>
          {busy ? "Armando…" : `Imprimir ${total} etiqueta${total === 1 ? "" : "s"}`}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
