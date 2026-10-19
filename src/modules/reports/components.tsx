import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { downloadXlsx } from "@/modules/inventory/import/files";
import { change } from "./dates";

export function Panel({ title, right, children, className }: { title: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-3 rounded-xl border bg-card p-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Indicador con variación contra el periodo anterior (texto, no color). */
export function Kpi({ label, value, current, previous, hint, invert = false }: {
  label: string;
  value: string;
  current?: number;
  previous?: number;
  hint?: string;
  /** Cuando subir es malo (descuentos, diferencias). */
  invert?: boolean;
}) {
  const delta = current !== undefined && previous !== undefined ? change(current, previous) : null;
  const good = delta === null ? null : invert ? delta < 0 : delta > 0;
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="mono-cap text-[10px] text-muted-foreground">{label}</p>
      <p className="num text-xl font-bold">{value}</p>
      {delta !== null && (
        <p className="num text-xs text-muted-foreground">
          <span aria-hidden>{delta > 0 ? "▲" : delta < 0 ? "▼" : "="}</span>{" "}
          {Math.abs(delta * 100).toLocaleString("es-VE", { maximumFractionDigits: 1 })} % vs periodo anterior
          {good === false && <span className="sr-only"> (empeoró)</span>}
        </p>
      )}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export interface Column<T> {
  header: string;
  value: (row: T) => string | number | null;
  /** Texto en pantalla; si falta, se muestra value. */
  render?: (row: T) => ReactNode;
  align?: "left" | "right";
}

export function DataTable<T>({ rows, columns, empty = "Sin datos en el periodo", rowKey }: {
  rows: T[];
  columns: Column<T>[];
  empty?: string;
  rowKey: (row: T, i: number) => string;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            {columns.map((c) => (
              <th key={c.header} className={cn("mono-cap whitespace-nowrap px-2 py-1 text-[10px] font-normal text-muted-foreground", c.align === "right" && "text-right")}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey(r, i)} className="border-b last:border-0">
              {columns.map((c) => (
                <td key={c.header} className={cn("px-2 py-1.5", c.align === "right" && "num whitespace-nowrap text-right")}>
                  {c.render ? c.render(r) : (c.value(r) ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ExportButton<T>({ fileName, rows, columns }: { fileName: string; rows: T[]; columns: Column<T>[] }) {
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={rows.length === 0}
      onClick={() => downloadXlsx(`${fileName}.xlsx`, columns.map((c) => c.header), rows.map((r) => columns.map((c) => c.value(r))), "Reporte")}
    >
      Excel
    </Button>
  );
}

/**
 * Columnas de una sola serie: sin leyenda (el título la nombra), barras de
 * hasta 24 px con punta redondeada, grilla de 1 px y detalle al pasar el dedo.
 */
export function ColumnChart<T extends object>({ data, x, y, formatX, formatY, label }: {
  data: T[];
  x: keyof T & string;
  y: keyof T & string;
  formatX: (v: T[keyof T]) => string;
  formatY: (v: number) => string;
  label: string;
}) {
  return (
    <div className="h-56 w-full" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <XAxis
            dataKey={x}
            tickFormatter={(v) => formatX(v)}
            tickLine={false}
            axisLine={{ stroke: "hsl(var(--border))" }}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            minTickGap={12}
          />
          <YAxis
            tickFormatter={(v: number) => compact(v)}
            tickLine={false}
            axisLine={false}
            width={44}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          />
          <Tooltip
            cursor={{ fill: "hsl(var(--muted) / 0.5)" }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <div className="rounded-md border bg-card px-2 py-1 text-xs shadow">
                  <p className="text-muted-foreground">{formatX(payload[0].payload[x])}</p>
                  <p className="num font-semibold">{formatY(Number(payload[0].value))}</p>
                </div>
              ) : null
            }
          />
          <Bar dataKey={y} fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function compact(v: number): string {
  return Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString("es-VE", { maximumFractionDigits: 1 })}K` : v.toLocaleString("es-VE", { maximumFractionDigits: 0 });
}
