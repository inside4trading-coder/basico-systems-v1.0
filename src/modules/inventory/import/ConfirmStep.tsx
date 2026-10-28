/**
 * «Así entendimos tu archivo»: cinco productos tal como quedarían. Cada campo
 * tiene «Cambiar», que abre las columnas del archivo como tarjetas con sus
 * valores. Pensado para que cualquiera lo confirme sin saber de columnas.
 */
import { useState } from "react";
import { Pencil } from "lucide-react";
import ColumnPicker from "./ColumnPicker";
import type { TargetField } from "./fields";
import { assignField, columnOf, stockColumn, type SheetState } from "./sheetState";

const SAMPLE_ROWS = 5;

type FieldKey = "name" | "sku" | "regular_price" | "stock" | "brand";

const FIELDS: { key: FieldKey; label: string; question: string }[] = [
  { key: "name", label: "Nombre", question: "¿Dónde está el nombre del producto?" },
  { key: "sku", label: "Código", question: "¿Dónde está el código del producto?" },
  { key: "regular_price", label: "Precio", question: "¿Dónde está el precio de venta?" },
  { key: "stock", label: "Cantidad", question: "¿Dónde está la cantidad que tienes?" },
  { key: "brand", label: "Marca", question: "¿Dónde está la marca?" },
];

export default function ConfirmStep({
  sheet,
  defaultLocation,
  onChange,
}: {
  sheet: SheetState;
  /** Sede para la cantidad cuando todavía no hay columna de existencia. */
  defaultLocation: string | null;
  onChange: (patch: Partial<SheetState>) => void;
}) {
  const { mapping, parsed } = sheet;
  const stock = stockColumn(mapping);
  const headerOf = (key: FieldKey) => (key === "stock" ? (stock?.header ?? "") : columnOf(mapping, key as TargetField));
  // Sin nombre o sin precio no se puede vender: esa pregunta se abre sola.
  const [open, setOpen] = useState<FieldKey | null>(() => (!headerOf("name") ? "name" : !headerOf("regular_price") ? "regular_price" : null));

  const pick = (key: FieldKey, header: string) => {
    if (key === "stock") {
      const location = stock?.location ?? defaultLocation;
      const next = Object.fromEntries(Object.entries(mapping).map(([h, f]) => [h, f.startsWith("stock:") ? "" : f])) as typeof mapping;
      if (header && location) next[header] = `stock:${location}`;
      onChange({ mapping: next });
    } else {
      onChange({ mapping: assignField(mapping, key, header) });
    }
    setOpen(null);
  };

  const rows = parsed.rows.filter((r) => headerOf("name") === "" || r[headerOf("name")]).slice(0, SAMPLE_ROWS);
  const current = FIELDS.find((f) => f.key === open);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[640px] table-fixed text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              {FIELDS.map((f) => {
                const h = headerOf(f.key);
                return (
                  <th key={f.key} className={`px-3 py-2 text-left align-top font-normal ${f.key === "name" ? "w-[34%]" : ""}`}>
                    <span className="flex flex-col items-start gap-1">
                      <span className="font-medium">{f.label}</span>
                      <button
                        type="button"
                        onClick={() => setOpen(open === f.key ? null : f.key)}
                        aria-expanded={open === f.key}
                        className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs hover:border-primary ${open === f.key ? "border-primary text-primary" : h ? "bg-background" : "border-destructive text-destructive"}`}
                      >
                        <Pencil className="h-3 w-3" aria-hidden /> {h ? "Cambiar" : "Elegir"}
                      </button>
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground" title={h}>
                      {h ? `de «${h}»` : "Falta elegir la columna"}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b last:border-0">
                {FIELDS.map((f) => {
                  const h = headerOf(f.key);
                  const v = h ? r[h] : "";
                  return (
                    <td key={f.key} className="truncate px-3 py-2" title={v}>
                      {v ? (f.key === "regular_price" ? `${v} $` : v) : <span className="text-muted-foreground">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {current && (
        <div className="space-y-2 rounded-surface border bg-muted/20 p-3">
          <p className="font-medium">{current.question}</p>
          <p className="text-xs text-muted-foreground">Toca la columna que tiene esos datos.</p>
          <ColumnPicker sheet={parsed} value={headerOf(current.key)} onPick={(h) => pick(current.key, h)} />
        </div>
      )}
    </div>
  );
}
