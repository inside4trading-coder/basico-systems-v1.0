/**
 * Plantillas de etiqueta: tamaño (rollo u hoja), código, encabezado y campos,
 * con vista previa en vivo. Las de fábrica no se editan, pero se duplican.
 */
import { useState } from "react";
import { Copy, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTenant } from "@/core/tenant-context";
import { cn } from "@/lib/utils";
import { useDeleteLabelTemplate, useLabelHeader, useLabelTemplates, useSaveLabelTemplate } from "./api";
import {
  CODE_KIND_LABEL,
  PAGE_SIZE_MM,
  PRESET_TEMPLATES,
  isPreset,
  templateProblem,
  type LabelCodeKind,
  type LabelTemplate,
  type LabelTemplateDraft,
} from "./labels";
import LabelPreview from "./LabelPreview";

const SAMPLE = {
  name: "Nombre del producto de ejemplo",
  detail: "Variante · Marca",
  sku: "SKU-0001",
  code: "7590000000017",
  price: "$ 12,50",
  priceLocal: "Bs. 11.000,00",
};

const ROLL_SIZES: [number, number][] = [
  [50, 25], [40, 30], [57, 32], [62, 29], [100, 50], [100, 100],
];
const SHEET_SIZES: { label: string; page: "letter" | "a4"; w: number; h: number; c: number; r: number }[] = [
  { label: "Carta 3 × 10", page: "letter", w: 66.7, h: 25.4, c: 3, r: 10 },
  { label: "Carta 2 × 5", page: "letter", w: 101.6, h: 50.8, c: 2, r: 5 },
  { label: "Carta 4 × 20", page: "letter", w: 44.5, h: 12.7, c: 4, r: 20 },
  { label: "A4 3 × 8", page: "a4", w: 70, h: 37, c: 3, r: 8 },
  { label: "A4 3 × 7", page: "a4", w: 63.5, h: 38.1, c: 3, r: 7 },
];

function toDraft(t: LabelTemplate): LabelTemplateDraft {
  const { id: _id, ...rest } = t;
  return rest;
}

export default function TemplatesPanel() {
  const { can } = useTenant();
  const editable = can("catalogo.editar");
  const templates = useLabelTemplates();
  const del = useDeleteLabelTemplate();
  const save = useSaveLabelTemplate();
  const [editing, setEditing] = useState<{ id: string | null; draft: LabelTemplateDraft } | null>(null);

  const own = templates.data?.own ?? [];
  const startNew = () => setEditing({ id: null, draft: { ...toDraft(PRESET_TEMPLATES[0]), name: "Mi etiqueta" } });
  const duplicate = (t: LabelTemplate) => setEditing({ id: null, draft: { ...toDraft(t), name: `${t.name} (copia)`, is_default: false } });
  const makeDefault = (t: LabelTemplate) =>
    save.mutate(
      { id: t.id, draft: { ...toDraft(t), is_default: true } },
      { onSuccess: () => toast.success(`«${t.name}» es la predeterminada`), onError: (e) => toast.error(e.message) },
    );
  const remove = (t: LabelTemplate) => {
    if (!window.confirm(`¿Borrar la plantilla «${t.name}»?`)) return;
    del.mutate(t.id, { onSuccess: () => toast.success("Plantilla borrada"), onError: (e) => toast.error(e.message) });
  };

  if (editing) {
    return (
      <TemplateEditor
        initial={editing.draft}
        busy={save.isPending}
        onCancel={() => setEditing(null)}
        onSave={(draft) =>
          save.mutate(
            { id: editing.id, draft },
            {
              onSuccess: () => {
                toast.success("Plantilla guardada");
                setEditing(null);
              },
              onError: (e) => toast.error("No se pudo guardar", { description: e.message }),
            },
          )
        }
      />
    );
  }

  const row = (t: LabelTemplate) => (
    <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
      <div className="min-w-0">
        <p className="font-medium">
          {t.name} {t.is_default && <Badge>Predeterminada</Badge>} {isPreset(t.id) && <Badge variant="secondary">De fábrica</Badge>}
        </p>
        <p className="text-xs text-muted-foreground">
          {t.media === "sheet" ? `Hoja ${PAGE_SIZE_MM[t.page].label} ${t.columns} × ${t.rows}` : "Rollo"} · {t.width_mm} × {t.height_mm} mm ·{" "}
          {CODE_KIND_LABEL[t.code_kind]}
        </p>
      </div>
      {editable && (
        <div className="flex flex-wrap gap-1">
          {!isPreset(t.id) && !t.is_default && (
            <Button size="sm" variant="ghost" onClick={() => makeDefault(t)}>
              <Star className="h-4 w-4" /> Predeterminada
            </Button>
          )}
          {!isPreset(t.id) && (
            <Button size="sm" variant="ghost" onClick={() => setEditing({ id: t.id, draft: toDraft(t) })}>
              <Pencil className="h-4 w-4" /> Editar
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => duplicate(t)}>
            <Copy className="h-4 w-4" /> Duplicar
          </Button>
          {!isPreset(t.id) && (
            <Button size="sm" variant="ghost" aria-label={`Borrar ${t.name}`} onClick={() => remove(t)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
    </li>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Tamaño, código y qué datos lleva cada etiqueta. La predeterminada abre al imprimir.</p>
        {editable && (
          <Button onClick={startNew}>
            <Plus className="h-4 w-4" /> Nueva plantilla
          </Button>
        )}
      </div>
      {templates.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
      <ul className="divide-y rounded-xl border bg-card">
        {own.map(row)}
        {PRESET_TEMPLATES.map(row)}
      </ul>
    </div>
  );
}

function NumberField({ id, label, value, onChange, step = 0.1 }: { id: string; label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" inputMode="decimal" step={step} value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={cn("flex items-center gap-2 text-sm", disabled && "opacity-50")}>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label} />
      {label}
    </label>
  );
}

function TemplateEditor({
  initial,
  busy,
  onCancel,
  onSave,
}: {
  initial: LabelTemplateDraft;
  busy: boolean;
  onCancel: () => void;
  onSave: (draft: LabelTemplateDraft) => void;
}) {
  const [d, setD] = useState<LabelTemplateDraft>(initial);
  const set = <K extends keyof LabelTemplateDraft>(key: K, value: LabelTemplateDraft[K]) => setD((x) => ({ ...x, [key]: value }));
  const header = useLabelHeader(d);
  const problem = templateProblem(d);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <form
        className="space-y-5 rounded-xl border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (problem) return toast.error(problem);
          onSave(d);
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="tpl-name">Nombre</Label>
          <Input id="tpl-name" maxLength={60} value={d.name} onChange={(e) => set("name", e.target.value)} />
        </div>

        <fieldset className="space-y-3">
          <legend className="mono-cap text-xs text-muted-foreground">Tamaño</legend>
          <div className="flex gap-2" role="group" aria-label="Formato">
            {(["roll", "sheet"] as const).map((m) => (
              <Button key={m} type="button" size="sm" variant={d.media === m ? "default" : "outline"} aria-pressed={d.media === m} onClick={() => set("media", m)}>
                {m === "roll" ? "Rollo (una por etiqueta)" : "Hoja de etiquetas"}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {d.media === "roll"
              ? ROLL_SIZES.map(([w, h]) => (
                  <Button key={`${w}x${h}`} type="button" size="sm" variant="ghost" className="h-7 border" onClick={() => setD((x) => ({ ...x, width_mm: w, height_mm: h }))}>
                    {w} × {h}
                  </Button>
                ))
              : SHEET_SIZES.map((s) => (
                  <Button
                    key={s.label}
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 border"
                    onClick={() => setD((x) => ({ ...x, page: s.page, width_mm: s.w, height_mm: s.h, columns: s.c, rows: s.r }))}
                  >
                    {s.label}
                  </Button>
                ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField id="tpl-w" label="Ancho (mm)" value={d.width_mm} onChange={(v) => set("width_mm", v)} />
            <NumberField id="tpl-h" label="Alto (mm)" value={d.height_mm} onChange={(v) => set("height_mm", v)} />
          </div>
          {d.media === "sheet" && (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="tpl-page">Hoja</Label>
                <select
                  id="tpl-page"
                  value={d.page}
                  onChange={(e) => set("page", e.target.value as LabelTemplateDraft["page"])}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="letter">Carta</option>
                  <option value="a4">A4</option>
                </select>
              </div>
              <NumberField id="tpl-cols" label="Columnas" step={1} value={d.columns} onChange={(v) => set("columns", Math.round(v))} />
              <NumberField id="tpl-rows" label="Filas" step={1} value={d.rows} onChange={(v) => set("rows", Math.round(v))} />
            </div>
          )}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="mono-cap text-xs text-muted-foreground">Código</legend>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Código">
            {(Object.keys(CODE_KIND_LABEL) as LabelCodeKind[]).map((k) => (
              <Button key={k} type="button" size="sm" variant={d.code_kind === k ? "default" : "outline"} aria-pressed={d.code_kind === k} onClick={() => set("code_kind", k)}>
                {CODE_KIND_LABEL[k]}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Lleva el código de barras del producto o, si no tiene, su SKU.</p>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="mono-cap text-xs text-muted-foreground">Encabezado</legend>
          <Toggle label="Encabezado arriba" checked={d.show_header} onChange={(v) => set("show_header", v)} />
          {d.show_header && (
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <div className="space-y-1">
                <Label htmlFor="tpl-header">Texto</Label>
                <Input
                  id="tpl-header"
                  maxLength={60}
                  value={d.header_text ?? ""}
                  placeholder={header.text || "Nombre del negocio"}
                  onChange={(e) => set("header_text", e.target.value)}
                />
              </div>
              <Toggle label="RIF" checked={d.show_tax_id} onChange={(v) => set("show_tax_id", v)} />
            </div>
          )}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="mono-cap text-xs text-muted-foreground">Datos</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <Toggle label="Nombre del producto" checked={d.show_name} onChange={(v) => set("show_name", v)} />
            <Toggle label="Variante y marca" checked={d.show_detail} onChange={(v) => set("show_detail", v)} />
            <Toggle label="SKU" checked={d.show_sku} onChange={(v) => set("show_sku", v)} />
            <Toggle label="Precio" checked={d.show_price} onChange={(v) => set("show_price", v)} />
            <Toggle label="Precio en bolívares" checked={d.show_price_local} disabled={!d.show_price} onChange={(v) => set("show_price_local", v)} />
          </div>
        </fieldset>

        <Toggle label="Usar como predeterminada" checked={d.is_default} onChange={(v) => set("is_default", v)} />

        {problem && <p className="text-sm text-destructive">{problem}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" disabled={busy || Boolean(problem)}>
            {busy ? "Guardando…" : "Guardar plantilla"}
          </Button>
        </div>
      </form>

      <aside className="space-y-2 rounded-xl border bg-card p-4 lg:sticky lg:top-4 lg:self-start" aria-label="Vista previa">
        <p className="mono-cap text-xs text-muted-foreground">Vista previa</p>
        {d.width_mm >= 15 && d.width_mm <= 200 && d.height_mm >= 10 && d.height_mm <= 200 ? (
          <LabelPreview item={SAMPLE} template={d} header={header} maxWidth={340} />
        ) : (
          <p className="text-sm text-muted-foreground">Ajusta el tamaño para ver la etiqueta.</p>
        )}
        <p className="text-xs text-muted-foreground">Tamaño real: {d.width_mm} × {d.height_mm} mm.</p>
      </aside>
    </div>
  );
}
