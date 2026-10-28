/**
 * Paso 3: qué va a pasar con cada fila, agrupado por causa, antes de aplicar.
 */
import { useState } from "react";
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { groupIssues, type PreviewRow, type PreviewSummary } from "./preview";

const VISIBLE_ROWS = 300;

export default function ReviewStep({
  preview,
  summary,
  multiSheet,
  onDownloadNormalized,
}: {
  preview: PreviewRow[];
  summary: PreviewSummary;
  multiSheet: boolean;
  onDownloadNormalized: () => void;
}) {
  const [filter, setFilter] = useState<"all" | "blocked" | "warnings">("all");
  const visible = preview.filter((r) => (filter === "blocked" ? r.action === "Bloqueada" : filter === "warnings" ? r.warnings.length > 0 : true));
  const issues = groupIssues(preview);

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Tile label="Productos nuevos" value={summary.productsCreate} />
        <Tile label="Actualizaciones" value={summary.variantsUpdate} />
        <Tile label="SKU generados" value={summary.generatedSkus} />
        <Tile label="Saltadas" value={summary.skipped} />
        <Tile label="Bloqueadas" value={summary.blocked} alert={summary.blocked > 0} />
      </div>
      {issues.length > 0 && (
        <ul className="space-y-1 text-sm">
          {issues.slice(0, 6).map((g) => (
            <li key={g.kind} className={g.blocking ? "text-destructive" : "text-status-warning"}>
              <span className="num font-medium">{g.count}</span> {g.count === 1 ? "fila" : "filas"}: {g.kind}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["all", `Todas (${summary.total})`],
            ["blocked", `Bloqueadas (${summary.blocked})`],
            ["warnings", `Con avisos (${summary.withWarnings})`],
          ] as const
        ).map(([k, l]) => (
          <Button key={k} size="sm" variant={filter === k ? "default" : "outline"} onClick={() => setFilter(k)}>
            {l}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={onDownloadNormalized}>
          <Download /> Descargar normalizado
        </Button>
      </div>
      <div className="max-h-[480px] overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Fila</TableHead>
              <TableHead>Producto</TableHead>
              <TableHead>Acción</TableHead>
              <TableHead>Detalle</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.slice(0, VISIBLE_ROWS).map((r) => (
              <TableRow key={`${r.sheet}|${r.rowNumber}`}>
                <TableCell className="num text-xs">
                  {multiSheet && <span className="block text-muted-foreground">{r.sheet}</span>}
                  {r.rowNumber}
                </TableCell>
                <TableCell className="max-w-[280px] truncate">{r.label}</TableCell>
                <TableCell>
                  <Badge variant={r.action === "Bloqueada" ? "destructive" : r.action === "Crear" ? "default" : "secondary"}>{r.action}</Badge>
                </TableCell>
                <TableCell className="text-xs">
                  {r.errors.map((e) => (
                    <p key={e} className="text-destructive">
                      {e}
                    </p>
                  ))}
                  {r.warnings.map((w) => (
                    <p key={w} className="text-status-warning">
                      {w}
                    </p>
                  ))}
                  {r.notes.map((n) => (
                    <p key={n} className="text-muted-foreground">
                      {n}
                    </p>
                  ))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {visible.length > VISIBLE_ROWS && (
        <p className="text-xs text-muted-foreground">
          Mostrando {VISIBLE_ROWS} de {visible.length}.
        </p>
      )}
    </>
  );
}

function Tile({ label, value, alert = false }: { label: string; value: number; alert?: boolean }) {
  return (
    <Card className="p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`num text-2xl font-bold ${alert ? "text-destructive" : ""}`}>{value}</p>
    </Card>
  );
}
