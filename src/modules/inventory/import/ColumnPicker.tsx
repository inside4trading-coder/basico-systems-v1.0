/**
 * Elegir la columna de un campo viendo sus valores: cada columna del archivo
 * es una tarjeta con sus primeros datos, más «No lo tengo».
 */
import type { ParsedSheet } from "./files";

const SAMPLES = 3;

export default function ColumnPicker({
  sheet,
  value,
  onPick,
  exclude = [],
  allowNone = true,
}: {
  sheet: ParsedSheet;
  value: string;
  onPick: (header: string) => void;
  /** Columnas que no se ofrecen (ya usadas en otro campo). */
  exclude?: string[];
  /** Muestra la tarjeta «No lo tengo». */
  allowNone?: boolean;
}) {
  const columns = sheet.headers
    .filter((h) => !exclude.includes(h))
    .map((h) => ({ h, samples: sheet.rows.map((r) => r[h]).filter(Boolean).slice(0, SAMPLES) }))
    .filter((c) => c.samples.length > 0);
  const card = (selected: boolean) =>
    `min-w-0 rounded-surface border p-3 text-left transition-colors hover:border-primary ${selected ? "border-2 border-primary bg-primary/5" : "bg-card"}`;

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {columns.map(({ h, samples }) => (
        <button key={h} type="button" onClick={() => onPick(h)} className={card(value === h)} aria-pressed={value === h}>
          <span className="mono-cap block truncate text-[10px] text-muted-foreground">{h}</span>
          {samples.map((s, i) => (
            <span key={i} className="block truncate text-sm">
              {s}
            </span>
          ))}
        </button>
      ))}
      {allowNone && (
        <button type="button" onClick={() => onPick("")} className={card(value === "")} aria-pressed={value === ""}>
          <span className="mono-cap block text-[10px] text-muted-foreground">&nbsp;</span>
          <span className="block text-sm">No lo tengo</span>
        </button>
      )}
      {columns.length === 0 && !allowNone && <p className="text-sm text-muted-foreground">Ya usaste todas las columnas con datos.</p>}
    </div>
  );
}
