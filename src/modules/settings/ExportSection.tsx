/** Descargar todos los datos del negocio en un Excel (solo dueño o administrador). */
import { useState } from "react";
import { toast } from "sonner";
import writeXlsxFile, { type SheetData } from "write-excel-file/browser";
import { Button } from "@/components/ui/button";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";
import { caracasToday } from "@/modules/reports/dates";
import { EXPORT_SHEETS, MAX_ROWS_PER_SHEET, PAGE_SIZE, exportFileName, toTable } from "./exportData";

async function readAll(table: string, order: string[]): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; from < MAX_ROWS_PER_SHEET; from += PAGE_SIZE) {
    let q = supabase.from(table).select("*");
    for (const col of order) q = q.order(col, { ascending: true });
    const { data, error } = await q.range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < PAGE_SIZE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

export default function ExportSection() {
  const { active } = useTenant();
  const [progress, setProgress] = useState<string | null>(null);

  const run = async () => {
    try {
      const sheets: { data: SheetData; sheet: string; stickyRowsCount: number }[] = [];
      const cut: string[] = [];
      for (const [i, spec] of EXPORT_SHEETS.entries()) {
        setProgress(`${spec.sheet} (${i + 1} de ${EXPORT_SHEETS.length})`);
        const { rows, truncated } = await readAll(spec.table, spec.order);
        if (truncated) cut.push(spec.sheet);
        const { headers, rows: cells } = toTable(rows);
        const data: SheetData = [
          (headers.length ? headers : ["(sin datos)"]).map((h) => ({ value: h, fontWeight: "bold" as const })),
          ...cells.map((r) => r.map((value) => (value === null ? null : { value }))),
        ];
        sheets.push({ data, sheet: spec.sheet, stickyRowsCount: 1 });
      }
      setProgress("Armando el archivo…");
      await writeXlsxFile(sheets).toFile(exportFileName(active?.tenant.name ?? "negocio", caracasToday()));
      toast.success("Datos exportados", {
        description: cut.length ? `Hojas recortadas a ${MAX_ROWS_PER_SHEET.toLocaleString("es-VE")} filas: ${cut.join(", ")}` : undefined,
      });
    } catch (err) {
      toast.error("No se pudo exportar", { description: (err as Error).message });
    } finally {
      setProgress(null);
    }
  };

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <div>
        <h2 className="text-base">Exportar datos</h2>
        <p className="text-sm text-muted-foreground">
          Descarga un Excel con todo lo del negocio: catálogo, stock, ventas, caja, administración, cuentas por cobrar y banco. Una hoja por tabla. Los datos
          son tuyos.
        </p>
      </div>
      <Button onClick={run} disabled={progress !== null}>
        {progress ? `Leyendo ${progress}` : "Descargar Excel"}
      </Button>
    </section>
  );
}
