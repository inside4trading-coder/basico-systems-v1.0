/**
 * Imprimir etiquetas: se buscan productos, se indica cuántas de cada uno y se
 * elige la plantilla (rollo u hoja, con o sin código, qué campos).
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Minus, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/core/supabase";
import { formatMoney } from "@/modules/pos/cart";
import { printReceipt } from "@/modules/pos/receipt";
import { productTaxRate, withTax } from "@/core/tax";
import { useCurrentRate, useTaxRates, useTenantSettings } from "@/modules/settings/api";
import { defaultTemplate, useLabelHeader, useLabelTemplates } from "./api";
import { codeSvg } from "./codes";
import { CODE_KIND_LABEL, expandLabels, labelsHtml, type LabelItem, type LabelTemplate } from "./labels";
import LabelPreview from "./LabelPreview";

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

const MAX_LABELS = 500;

/** Código de barras y tipo de IVA de cada variante (para el código y el PVP). */
async function loadLabelData(ids: string[]) {
  const [codes, taxOf] = await Promise.all([
    supabase.from("product_codes").select("variant_id, code").eq("kind", "barcode").in("variant_id", ids),
    supabase.from("variants").select("id, products(tax_rate_id)").in("id", ids),
  ]);
  if (codes.error) throw new Error(codes.error.message);
  if (taxOf.error) throw new Error(taxOf.error.message);
  return {
    codeByVariant: new Map((codes.data ?? []).map((c) => [c.variant_id as string, c.code as string])),
    taxIdByVariant: new Map(
      (taxOf.data ?? []).map((v) => [v.id as string, (v.products as unknown as { tax_rate_id: string | null } | null)?.tax_rate_id ?? null]),
    ),
  };
}
type LabelData = Awaited<ReturnType<typeof loadLabelData>>;

function templateSummary(t: LabelTemplate) {
  const size = `${t.width_mm} × ${t.height_mm} mm`;
  return t.media === "sheet" ? `Hoja ${t.page === "a4" ? "A4" : "carta"} ${t.columns} × ${t.rows} · ${size}` : `Rollo · ${size}`;
}

export default function PrintPanel() {
  const { data: settings } = useTenantSettings();
  const { data: rate } = useCurrentRate();
  const { data: taxRates = [] } = useTaxRates();
  const templates = useLabelTemplates();
  const all = useMemo(() => templates.data?.all ?? [], [templates.data]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const template = all.find((t) => t.id === templateId) ?? (all.length ? defaultTemplate(all) : null);
  const header = useLabelHeader(template);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
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
    setRows((r) => r.map((x) => (x.hit.variant_id === id ? { ...x, copies: Math.max(1, Math.min(MAX_LABELS, copies)) } : x)));
  const total = rows.reduce((a, r) => a + r.copies, 0);

  // La etiqueta lleva el PVP: el precio sin IVA más el IVA del producto.
  const toItem = (hit: Hit, data: LabelData): Omit<LabelItem, "codeSvg"> => {
    const net = Number(hit.price ?? 0);
    const price = settings?.prices_include_tax ? net : withTax(net, productTaxRate(data.taxIdByVariant.get(hit.variant_id), taxRates));
    return {
      name: hit.product_name,
      detail: [Object.values(hit.options ?? {}).join(" · "), hit.brand].filter(Boolean).join(" · ") || null,
      sku: hit.sku,
      code: data.codeByVariant.get(hit.variant_id) ?? hit.sku ?? "",
      price: price > 0 ? formatMoney(price, base) : "",
      priceLocal: local && rate?.rate && price > 0 ? formatMoney(price * rate.rate, local) : null,
    };
  };
  const first = rows[0]?.hit;
  const firstData = useQuery({
    queryKey: ["label-data", first?.variant_id],
    enabled: Boolean(first),
    queryFn: () => loadLabelData([first!.variant_id]),
  });
  const previewItem = first && firstData.data ? toItem(first, firstData.data) : null;

  const print = async () => {
    if (!template) return;
    setBusy(true);
    try {
      const data = await loadLabelData(rows.map((r) => r.hit.variant_id));
      const missing: string[] = [];
      const prepared = await Promise.all(
        rows.map(async (r) => {
          const fields = toItem(r.hit, data);
          if (!fields.code && template.code_kind !== "none") {
            missing.push(r.hit.product_name);
            return null;
          }
          const item: LabelItem = { ...fields, codeSvg: await codeSvg(template.code_kind, fields.code) };
          return { item, copies: r.copies };
        }),
      );
      const items = prepared.filter((x): x is { item: LabelItem; copies: number } => x !== null);
      if (missing.length) toast.warning("Sin código ni SKU, no se imprimen", { description: missing.join(", ") });
      if (total > MAX_LABELS) toast.warning(`Se imprimen las primeras ${MAX_LABELS} etiquetas`);
      if (items.length) printReceipt(labelsHtml(expandLabels(items, MAX_LABELS), template, header));
    } catch (err) {
      toast.error("No se pudieron armar las etiquetas", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="Productos">
        <div className="space-y-1">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar producto por nombre, código o SKU" aria-label="Buscar producto" />
          {hits.length > 0 && (
            <ul className="max-h-56 space-y-1 overflow-y-auto">
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
                className="num h-8 w-16 text-center"
                inputMode="numeric"
                aria-label={`Etiquetas de ${r.hit.product_name}`}
                value={r.copies}
                onChange={(e) => setCopies(r.hit.variant_id, Number(e.target.value) || 1)}
              />
              <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Más" onClick={() => setCopies(r.hit.variant_id, r.copies + 1)}>
                <Plus className="h-3 w-3" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                aria-label="Quitar"
                onClick={() => setRows((x) => x.filter((y) => y.hit.variant_id !== r.hit.variant_id))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
        {rows.length === 0 && <p className="text-sm text-muted-foreground">Busca y agrega los productos a etiquetar.</p>}
      </section>

      <aside className="space-y-3 rounded-xl border bg-card p-4" aria-label="Plantilla">
        <div className="space-y-1">
          <Label htmlFor="lbl-template">Plantilla</Label>
          <select
            id="lbl-template"
            value={template?.id ?? ""}
            onChange={(e) => setTemplateId(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {all.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.is_default ? " (predeterminada)" : ""}
              </option>
            ))}
          </select>
          {template && (
            <p className="text-xs text-muted-foreground">
              {templateSummary(template)} · {CODE_KIND_LABEL[template.code_kind]}
            </p>
          )}
        </div>
        {template && previewItem && <LabelPreview item={previewItem} template={template} header={header} />}
        <Button className="h-11 w-full" disabled={rows.length === 0 || busy || !template} onClick={print}>
          {busy ? "Armando…" : `Imprimir ${Math.min(total, MAX_LABELS)} etiqueta${total === 1 ? "" : "s"}`}
        </Button>
      </aside>
    </div>
  );
}
