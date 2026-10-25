/**
 * Etiquetas por unidad: cada pieza con su propio código (consecutivo o serial
 * del fabricante). Se activa por producto; el stock sigue por variante.
 */
import { useEffect, useMemo, useState } from "react";
import { Ban, Eye, Plus, Printer, Tag, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";
import { formatQty } from "@/modules/pos/cart";
import { printReceipt } from "@/modules/pos/receipt";
import { defaultTemplate, useLabelHeader, useLabelTemplates } from "./api";
import { codeSvg } from "./codes";
import { labelsHtml, type LabelItem, type LabelTemplate } from "./labels";
import { usePvp } from "./pricing";
import {
  ITEM_STATUS_LABEL,
  fetchItemLabels,
  fetchVariantInfo,
  missingLabels,
  parseSerials,
  useDisableItemLabels,
  useGenerateItemLabels,
  useMarkItemLabelsPrinted,
  useSetTrackUnits,
  useUnitOverview,
  useVariantItemLabels,
  type ItemLabel,
  type UnitOverviewRow,
} from "./unitsApi";

interface LookupHit {
  variant_id: string;
  product_id: string;
  product_name: string;
  options: Record<string, string> | null;
  sku: string | null;
  unit: string | null;
}

const variantText = (options: Record<string, string> | null) => Object.values(options ?? {}).join(" · ");

/** Imprime etiquetas por unidad con la plantilla y marca las nuevas como impresas. */
function usePrintUnits(template: LabelTemplate | null) {
  const header = useLabelHeader(template);
  const pvp = usePvp();
  const markPrinted = useMarkItemLabelsPrinted();
  return async (labels: ItemLabel[]): Promise<void> => {
    if (!template) return;
    const active = labels.filter((l) => l.status !== "disabled");
    if (active.length === 0) {
      toast.info("No hay etiquetas activas para imprimir");
      return;
    }
    const info = await fetchVariantInfo([...new Set(active.map((l) => l.variant_id))]);
    const items: LabelItem[] = await Promise.all(
      active.map(async (l) => {
        const v = info.get(l.variant_id);
        return {
          name: v?.name ?? "Producto",
          detail: v?.detail ?? null,
          sku: v?.sku ?? null,
          code: l.code,
          unitCode: l.code,
          ...pvp(v?.net, v?.taxRateId),
          codeSvg: await codeSvg(template.code_kind, l.code),
        };
      }),
    );
    printReceipt(labelsHtml(items, template, header));
    const fresh = active.filter((l) => l.status === "generated").map((l) => l.id);
    if (fresh.length) await markPrinted.mutateAsync(fresh);
  };
}

export default function UnitsPanel() {
  const { can } = useTenant();
  const editable = can("inventario.etiquetas");
  const overview = useUnitOverview();
  const setTrack = useSetTrackUnits();
  const templates = useLabelTemplates();
  const all = useMemo(() => templates.data?.all ?? [], [templates.data]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const template = all.find((t) => t.id === templateId) ?? (all.length ? defaultTemplate(all) : null);
  const print = usePrintUnits(template);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<LookupHit[]>([]);
  const [generating, setGenerating] = useState<UnitOverviewRow | null>(null);
  const [viewing, setViewing] = useState<UnitOverviewRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return setHits([]);
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc("catalog_lookup", { p_query: q, p_limit: 10 });
      if (!error) setHits((data ?? []) as LookupHit[]);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const rows = overview.data ?? [];
  const tracked = new Set(rows.map((r) => r.product_id));

  const activate = (hit: LookupHit) =>
    setTrack.mutate(
      { productId: hit.product_id, enabled: true },
      {
        onSuccess: () => {
          toast.success(`${hit.product_name}: etiqueta por unidad activada`);
          setQuery("");
          setHits([]);
        },
        onError: (e) => toast.error(e.message),
      },
    );

  const deactivate = (r: UnitOverviewRow) => {
    if (!window.confirm(`¿Quitar la etiqueta por unidad de «${r.product_name}»? Las etiquetas ya hechas se conservan.`)) return;
    setTrack.mutate({ productId: r.product_id, enabled: false }, { onError: (e) => toast.error(e.message) });
  };

  const printPending = async (r: UnitOverviewRow) => {
    setBusy(r.variant_id);
    try {
      await print(await fetchItemLabels({ variantId: r.variant_id, status: "generated" }));
    } catch (e) {
      toast.error("No se pudo imprimir", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Cada pieza lleva su propio código: consecutivo (SKU-00001) o el serial del fabricante. Sirve para seguir piezas de valor,
          con serial o en consignación. Lo que se vende por peso o medida no lleva etiqueta por unidad.
        </p>
        <div className="space-y-1">
          <Label htmlFor="unit-template">Plantilla</Label>
          <select
            id="unit-template"
            value={template?.id ?? ""}
            onChange={(e) => setTemplateId(e.target.value)}
            className="flex h-10 min-w-56 rounded-md border border-input bg-background px-3 text-sm"
          >
            {all.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.is_default ? " (predeterminada)" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {editable && (
        <div className="space-y-1 rounded-xl border bg-card p-3">
          <Label htmlFor="unit-activate">Activar un producto</Label>
          <Input
            id="unit-activate"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar producto por nombre, código o SKU"
          />
          {hits.length > 0 && (
            <ul className="max-h-56 space-y-1 overflow-y-auto pt-1">
              {hits
                .filter((h, i, list) => list.findIndex((x) => x.product_id === h.product_id) === i)
                .map((h) => (
                  <li key={h.product_id} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm">
                    <span className="min-w-0">
                      <span className="font-semibold">{h.product_name}</span>
                      <span className="block text-xs text-muted-foreground">{[h.sku, h.unit].filter(Boolean).join(" · ")}</span>
                    </span>
                    {tracked.has(h.product_id) ? (
                      <Badge variant="secondary">Ya activo</Badge>
                    ) : (
                      <Button size="sm" variant="outline" disabled={setTrack.isPending} onClick={() => activate(h)}>
                        <Plus className="h-4 w-4" /> Activar
                      </Button>
                    )}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      {overview.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {overview.isError && <p className="text-sm text-destructive">{(overview.error as Error).message}</p>}
      {!overview.isLoading && rows.length === 0 && (
        <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
          Ningún producto lleva etiqueta por unidad todavía.{editable ? " Actívala buscando el producto arriba." : ""}
        </p>
      )}

      {rows.length > 0 && (
        <ul className="divide-y rounded-xl border bg-card">
          {rows.map((r) => {
            const missing = missingLabels(r);
            return (
              <li key={r.variant_id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                <div className="min-w-0 space-y-0.5">
                  <p className="font-medium">
                    {r.product_name}
                    {variantText(r.options) && <span className="text-muted-foreground"> · {variantText(r.options)}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <span className="mono">{r.sku ?? "Sin SKU"}</span> · {formatQty(r.on_hand)} en existencia · {r.active_labels} con etiqueta
                    {r.to_print > 0 && ` · ${r.to_print} por imprimir`}
                    {r.disabled_labels > 0 && ` · ${r.disabled_labels} desactivadas`}
                  </p>
                  {missing > 0 && <Badge variant="outline">Faltan {missing} por etiquetar</Badge>}
                </div>
                <div className="flex flex-wrap gap-1">
                  {editable && (
                    <Button size="sm" onClick={() => setGenerating(r)}>
                      <Tag className="h-4 w-4" /> Generar
                    </Button>
                  )}
                  {editable && r.to_print > 0 && (
                    <Button size="sm" variant="outline" disabled={busy === r.variant_id} onClick={() => printPending(r)}>
                      <Printer className="h-4 w-4" /> Imprimir {r.to_print}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setViewing(r)}>
                    <Eye className="h-4 w-4" /> Ver
                  </Button>
                  {editable && (
                    <Button size="sm" variant="ghost" aria-label={`Quitar etiqueta por unidad de ${r.product_name}`} onClick={() => deactivate(r)}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {generating && (
        <GenerateDialog row={generating} onClose={() => setGenerating(null)} onPrint={print} />
      )}
      {viewing && <LabelsListDialog row={viewing} editable={editable} onClose={() => setViewing(null)} onPrint={print} />}
    </div>
  );
}

function GenerateDialog({ row, onClose, onPrint }: { row: UnitOverviewRow; onClose: () => void; onPrint: (labels: ItemLabel[]) => Promise<void> }) {
  const generate = useGenerateItemLabels();
  const [mode, setMode] = useState<"seq" | "serial">("seq");
  const [qty, setQty] = useState(String(missingLabels(row) || 1));
  const [serialText, setSerialText] = useState("");
  const [printNow, setPrintNow] = useState(true);
  const serials = parseSerials(serialText);

  const submit = async () => {
    try {
      const res = await generate.mutateAsync(
        mode === "seq" ? { variantId: row.variant_id, quantity: Number(qty) } : { variantId: row.variant_id, serials },
      );
      toast.success(`${res.created} etiqueta${res.created === 1 ? "" : "s"} generada${res.created === 1 ? "" : "s"}`);
      if (printNow && res.ids?.length) await onPrint(await fetchItemLabels({ ids: res.ids }));
      onClose();
    } catch (e) {
      toast.error("No se generaron", { description: (e as Error).message });
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generar etiquetas · {row.product_name}</DialogTitle>
        </DialogHeader>
        <div className="flex gap-2" role="group" aria-label="Tipo de código">
          <Button type="button" size="sm" variant={mode === "seq" ? "default" : "outline"} aria-pressed={mode === "seq"} onClick={() => setMode("seq")}>
            Consecutivas
          </Button>
          <Button type="button" size="sm" variant={mode === "serial" ? "default" : "outline"} aria-pressed={mode === "serial"} onClick={() => setMode("serial")}>
            Seriales del fabricante
          </Button>
        </div>
        {mode === "seq" ? (
          <div className="space-y-1">
            <Label htmlFor="gen-qty">Cuántas</Label>
            <Input id="gen-qty" type="number" min={1} max={500} value={qty} onChange={(e) => setQty(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              Siguen la numeración de {row.sku ?? "su SKU"} (por ejemplo {(row.sku ?? "SKU").toUpperCase()}-00001). Máximo 500.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            <Label htmlFor="gen-serials">Seriales</Label>
            <Textarea
              id="gen-serials"
              rows={6}
              value={serialText}
              onChange={(e) => setSerialText(e.target.value)}
              placeholder="Uno por línea. Puedes escanearlos con la pistola."
            />
            <p className="text-xs text-muted-foreground">{serials.length} serial{serials.length === 1 ? "" : "es"}</p>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={printNow} onCheckedChange={(v) => setPrintNow(v === true)} />
          Imprimir al generar
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={generate.isPending || (mode === "seq" ? !(Number(qty) >= 1 && Number(qty) <= 500) : serials.length === 0)}
            onClick={submit}
          >
            {generate.isPending ? "Generando…" : "Generar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LabelsListDialog({
  row,
  editable,
  onClose,
  onPrint,
}: {
  row: UnitOverviewRow;
  editable: boolean;
  onClose: () => void;
  onPrint: (labels: ItemLabel[]) => Promise<void>;
}) {
  const labels = useVariantItemLabels(row.variant_id);
  const disable = useDisableItemLabels();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const list = labels.data ?? [];
  const chosen = list.filter((l) => selected.has(l.id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const disableChosen = () => {
    const reason = window.prompt("Motivo (pieza dañada, perdida, etiqueta mal impresa…)");
    if (!reason?.trim()) return;
    disable.mutate(
      { ids: chosen.map((l) => l.id), reason },
      {
        onSuccess: (n) => {
          toast.success(`${n} etiqueta${n === 1 ? "" : "s"} desactivada${n === 1 ? "" : "s"}`);
          setSelected(new Set());
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Etiquetas · {row.product_name}
            {variantText(row.options) && ` · ${variantText(row.options)}`}
          </DialogTitle>
        </DialogHeader>
        {labels.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {!labels.isLoading && list.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay etiquetas.</p>}
        <ul className="divide-y rounded-lg border">
          {list.map((l) => (
            <li key={l.id} className="flex items-center gap-3 p-2 text-sm">
              {editable && (
                <Checkbox
                  aria-label={`Elegir ${l.code}`}
                  checked={selected.has(l.id)}
                  disabled={l.status === "disabled"}
                  onCheckedChange={() => toggle(l.id)}
                />
              )}
              <span className="mono min-w-0 flex-1 truncate">{l.code}</span>
              {l.is_serial && <Badge variant="outline">Serial</Badge>}
              <Badge variant={l.status === "disabled" ? "destructive" : l.status === "printed" ? "secondary" : "default"}>
                {ITEM_STATUS_LABEL[l.status]}
              </Badge>
              {l.disabled_reason && <span className="max-w-40 truncate text-xs text-muted-foreground">{l.disabled_reason}</span>}
            </li>
          ))}
        </ul>
        {editable && (
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={chosen.length === 0} onClick={() => onPrint(chosen).catch((e) => toast.error((e as Error).message))}>
              <Printer className="h-4 w-4" /> Imprimir {chosen.length || ""}
            </Button>
            <Button variant="outline" disabled={chosen.length === 0 || disable.isPending} onClick={disableChosen}>
              <Ban className="h-4 w-4" /> Desactivar {chosen.length || ""}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
