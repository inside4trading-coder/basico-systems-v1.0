/**
 * Paso 1: qué hojas se importan y en qué fila están los títulos de cada una.
 * Se muestran las primeras filas tal cual; tocar una la vuelve encabezado.
 */
import { columnLetter } from "./files";
import type { SheetState } from "./sheetState";

const PREVIEW_ROWS = 8;
const PREVIEW_COLS = 12;

export default function SheetStep({
  sheets,
  onChange,
}: {
  sheets: SheetState[];
  onChange: (index: number, patch: Partial<SheetState>) => void;
}) {
  return (
    <div className="space-y-4">
      {sheets.map((s, i) => (
        <div key={s.name + i} className="space-y-2">
          <label className="flex flex-wrap items-center gap-2 text-sm">
            <input type="checkbox" checked={s.include} onChange={(e) => onChange(i, { include: e.target.checked })} />
            <span className="font-medium">{s.name}</span>
            <span className="text-xs text-muted-foreground">
              {s.parsed.rows.length} filas con datos · títulos en la fila {s.headerIndex + 1}
            </span>
          </label>
          {s.include && (
            <>
              <p className="text-xs text-muted-foreground">Toca la fila que tiene los títulos de las columnas.</p>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full table-fixed text-xs">
                  <thead>
                    <tr className="bg-muted/50 text-muted-foreground">
                      <th className="w-10 px-2 py-1 text-left font-normal" />
                      {Array.from({ length: Math.min(PREVIEW_COLS, s.table[0]?.length ?? 0) }, (_, c) => (
                        <th key={c} className="w-28 px-2 py-1 text-left font-normal">
                          {columnLetter(c)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {s.table.slice(0, PREVIEW_ROWS).map((row, r) => (
                      <tr
                        key={r}
                        onClick={() => onChange(i, { headerIndex: r })}
                        className={`cursor-pointer border-t ${r === s.headerIndex ? "bg-primary/10 font-medium text-foreground" : r < s.headerIndex ? "text-muted-foreground/60" : "hover:bg-muted/40"}`}
                        aria-selected={r === s.headerIndex}
                      >
                        <td className="num px-2 py-1 text-muted-foreground">{r + 1}</td>
                        {row.slice(0, PREVIEW_COLS).map((cell, c) => (
                          <td key={c} className="truncate px-2 py-1" title={cell}>
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
