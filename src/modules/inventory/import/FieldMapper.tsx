/**
 * Paso 2: para cada campo del sistema, qué columna del archivo lo trae. Los
 * cinco campos de siempre van a la vista; el resto en «Más campos».
 */
import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { CODE_KIND_LABEL, FIXED_FIELD_LABEL, type TargetField } from "./fields";
import type { ImportRules } from "./rules";
import { assignField, columnOf, columnStats, extraField, type SheetState } from "./sheetState";

const COMMON_OPTIONS = ["Talla", "Color", "Medida", "Presentación"];

interface Props {
  sheet: SheetState;
  locations: { code: string; name: string }[];
  attributes: { key: string; label: string }[];
  taxRate: number;
  onChange: (patch: Partial<SheetState>) => void;
}

export default function FieldMapper({ sheet, locations, attributes, taxRate, onChange }: Props) {
  const { mapping, rules, parsed } = sheet;
  const setRules = (patch: Partial<ImportRules>) => onChange({ rules: { ...rules, ...patch } });
  const setDefault = (k: keyof ImportRules["defaults"], v: string) => setRules({ defaults: { ...rules.defaults, [k]: v || undefined } });
  const pick = (field: TargetField) => (header: string) => onChange({ mapping: assignField(mapping, field, header) });
  const example = (header: string) => (header ? (parsed.rows.find((r) => r[header])?.[header] ?? "") : "");

  const moreFields: [TargetField, string][] = [
    ["category", FIXED_FIELD_LABEL.category],
    ["description", FIXED_FIELD_LABEL.description],
    ["unit", FIXED_FIELD_LABEL.unit],
    ["price", "Oferta"],
    ["cost", FIXED_FIELD_LABEL.cost],
    ["active", FIXED_FIELD_LABEL.active],
    ...(Object.entries(CODE_KIND_LABEL).map(([k, l]) => [`code:${k}`, l]) as [TargetField, string][]),
    ...(COMMON_OPTIONS.map((o) => [`option:${o}`, `Opción: ${o}`]) as [TargetField, string][]),
    ...(attributes.map((a) => [`attr:${a.key}`, a.label]) as [TargetField, string][]),
  ];
  const usedInMore = moreFields.some(([f]) => columnOf(mapping, f));
  const [showMore, setShowMore] = useState(usedInMore);

  const skuHeader = columnOf(mapping, "sku");
  const skuStats = columnStats(parsed, skuHeader);
  const nameStats = columnStats(parsed, columnOf(mapping, "name"));

  const mainFieldSet = new Set<string>(["name", "sku", "regular_price", "brand", ...locations.map((l) => `stock:${l.code}`)]);
  const moreFieldSet = new Set<string>(moreFields.map(([f]) => f));
  const unused = parsed.headers.filter((h) => {
    const f = mapping[h] ?? "";
    return !f || (!mainFieldSet.has(f) && !moreFieldSet.has(f));
  });

  const row = (field: TargetField, label: ReactNode, extra?: ReactNode) => (
    <FieldRow key={field} label={label} headers={parsed.headers} value={columnOf(mapping, field)} onPick={pick(field)} example={example(columnOf(mapping, field))}>
      {extra}
    </FieldRow>
  );

  return (
    <div className="space-y-1">
      {row(
        "name",
        <>
          Nombre <span className="text-destructive">*</span>
        </>,
        nameStats.empty > 0 && (
          <Check checked={rules.skipNoName} onChange={(v) => setRules({ skipNoName: v })}>
            Saltar las {nameStats.empty} filas sin nombre
          </Check>
        ),
      )}
      {row(
        "sku",
        "Código del producto (SKU)",
        <div className="space-y-1">
          <Check checked={rules.autoSku} onChange={(v) => setRules({ autoSku: v })}>
            Generar SKU si falta o se repite
          </Check>
          {rules.autoSku && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              Empiezan con
              <Input value={rules.skuPrefix} onChange={(e) => setRules({ skuPrefix: e.target.value.slice(0, 10) })} className="h-7 w-20 text-xs" aria-label="Prefijo del SKU" />
            </div>
          )}
          {skuHeader && (skuStats.empty > 0 || skuStats.repeated > 0) && (
            <p className="text-xs text-muted-foreground">
              {[skuStats.empty && `${skuStats.empty} sin código`, skuStats.repeated && `${skuStats.repeated} repetidos`].filter(Boolean).join(" · ")}
              {rules.autoSku && skuStats.repeated > 0 && ". El código original queda guardado y se puede buscar."}
            </p>
          )}
        </div>,
      )}
      {row(
        "regular_price",
        "Precio de venta",
        <Check checked={rules.pricesIncludeTax} onChange={(v) => setRules({ pricesIncludeTax: v })}>
          Ya incluye IVA{taxRate > 0 ? ` (${taxRate} %)` : ""}
        </Check>,
      )}
      {locations.map((l) => row(`stock:${l.code}`, locations.length > 1 ? `Existencia en ${l.name}` : "Existencia"))}
      {row("brand", FIXED_FIELD_LABEL.brand)}

      <button type="button" onClick={() => setShowMore((v) => !v)} className="flex items-center gap-1 pt-3 text-sm text-muted-foreground hover:text-foreground">
        <ChevronDown className={`h-4 w-4 transition-transform ${showMore ? "rotate-180" : ""}`} /> Más campos (opcional)
      </button>
      {showMore &&
        moreFields.map(([field, label]) => {
          const def = field === "category" ? "category" : field === "unit" ? "unit" : null;
          return row(
            field,
            label,
            def ? (
              <Input
                value={rules.defaults[def] ?? ""}
                onChange={(e) => setDefault(def, e.target.value)}
                placeholder="Si viene vacía…"
                className="h-8 text-xs"
                aria-label={`${label} por defecto`}
              />
            ) : undefined,
          );
        })}

      {unused.length > 0 && (
        <div className="space-y-1 pt-4">
          <p className="mono-cap text-xs text-muted-foreground">Columnas sin usar</p>
          {unused.map((h) => {
            const numericTitle = /^Columna [A-Z]+ \(/.test(h);
            const hasData = parsed.rows.some((r) => r[h]);
            const extra = extraField(h);
            return (
              <div key={h} className="flex flex-wrap items-center gap-2 text-sm">
                {numericTitle || !hasData ? (
                  <span className="text-xs text-muted-foreground">
                    {h} · {hasData ? "parece un cálculo, no se importa" : "vacía"}
                  </span>
                ) : (
                  <Check checked={mapping[h] === extra} onChange={(v) => onChange({ mapping: { ...mapping, [h]: v ? extra : "" } })}>
                    Guardar «{h}» como dato extra
                    <span className="ml-1 text-xs text-muted-foreground">{example(h)}</span>
                  </Check>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FieldRow({
  label,
  headers,
  value,
  onPick,
  example,
  children,
}: {
  label: ReactNode;
  headers: string[];
  value: string;
  onPick: (header: string) => void;
  example: string;
  children?: ReactNode;
}) {
  return (
    <div className="grid items-center gap-2 border-b py-2 text-sm sm:grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)]">
      <span>{label}</span>
      <select
        aria-label={typeof label === "string" ? `Columna para ${label}` : "Columna"}
        value={value}
        onChange={(e) => onPick(e.target.value)}
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
      >
        <option value="">— no viene —</option>
        {headers.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <div className="min-w-0 text-xs text-muted-foreground">{children ?? <span className="block truncate">{example}</span>}</div>
    </div>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}
