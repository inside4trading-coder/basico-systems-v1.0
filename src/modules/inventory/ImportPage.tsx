/**
 * Importar y exportar catálogo. Portado de SublimeInventarioImportExport.tsx
 * (basicosystems@f551478b): en vez de 27 columnas fijas, el usuario asigna
 * cada columna de su Excel a un campo y puede guardar ese mapeo como
 * plantilla para la próxima vez.
 */
import { useMemo, useState, type ChangeEvent } from "react";
import { Navigate } from "react-router-dom";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import BackLink from "@/components/BackLink";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useTenant } from "@/core/tenant-context";
import { canEditCatalog } from "@/core/tenant-selection";
import { useCatalog, useLocations } from "./api";
import { useApplyImport, useAttributeDefs, useImportJobs, useImportTemplates, useSaveImportTemplate, type ImportResult } from "./import/api";
import { exportCatalog, downloadTemplate } from "./import/exportCatalog";
import { CODE_KIND_LABEL, fieldLabel, FIXED_FIELD_LABEL, suggestMapping, type ColumnMapping, type TargetField } from "./import/fields";
import { downloadCsv, hashFile, readSpreadsheet, type ParsedSheet } from "./import/files";
import { buildPreview, type CatalogIndexEntry } from "./import/preview";
import { RUBROS } from "./import/rubros";
import { formatDateTime } from "./lib";

const COMMON_OPTIONS = ["Talla", "Color", "Medida", "Presentación"];

interface LoadedFile {
  file: File;
  hash: string;
  sheet: ParsedSheet;
}

export default function ImportPage() {
  const { active } = useTenant();
  const { data: catalog } = useCatalog();
  const { data: locations = [] } = useLocations();
  const { data: defs = [] } = useAttributeDefs();
  const { data: templates = [] } = useImportTemplates();
  const { data: jobs = [] } = useImportJobs();
  const saveTemplate = useSaveImportTemplate();
  const apply = useApplyImport();

  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [templateName, setTemplateName] = useState("");
  const [filter, setFilter] = useState<"all" | "blocked" | "warnings">("all");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [rubroId, setRubroId] = useState(RUBROS[0].id);
  const [busy, setBusy] = useState(false);

  const activeLocations = useMemo(() => locations.filter((l) => l.is_active), [locations]);
  const defaultLocation = activeLocations.find((l) => l.sells_in_pos && l.type === "store") ?? activeLocations[0];

  const targetOptions = useMemo(() => {
    const fromMapping = Object.values(mapping).filter((f) => f.startsWith("option:")) as TargetField[];
    const options: TargetField[] = [
      ...(Object.keys(FIXED_FIELD_LABEL) as TargetField[]),
      ...Array.from(new Set([...COMMON_OPTIONS.map((o) => `option:${o}` as TargetField), ...fromMapping])),
      ...(Object.keys(CODE_KIND_LABEL).map((k) => `code:${k}`) as TargetField[]),
      ...(defs.map((d) => `attr:${d.key}`) as TargetField[]),
      ...(activeLocations.map((l) => `stock:${l.code}`) as TargetField[]),
    ];
    return options;
  }, [mapping, defs, activeLocations]);
  const attributeLabels = useMemo(() => Object.fromEntries(defs.map((d) => [d.key, d.label])), [defs]);

  const index: CatalogIndexEntry[] = useMemo(() => {
    const codeById = new Map(locations.map((l) => [l.id, l.code]));
    return (catalog?.rows ?? []).map((r) => ({
      variantId: r.variant.id,
      productId: r.product.id,
      sku: r.variant.sku,
      codes: r.codes.map((c) => ({ kind: c.kind, code: c.code })),
      stockByLocationCode: Object.fromEntries(r.stocks.map((s) => [codeById.get(s.location_id) ?? "", Number(s.on_hand)])),
    }));
  }, [catalog, locations]);

  const preview = useMemo(() => {
    if (!loaded) return null;
    return buildPreview(
      loaded.sheet.rows,
      mapping,
      {
        catalog: index,
        locationCodes: activeLocations.map((l) => l.code),
        attributes: defs.map((d) => ({ key: d.key, multi: d.multi })),
      },
      loaded.sheet.firstDataRow,
    );
  }, [loaded, mapping, index, activeLocations, defs]);

  if (!canEditCatalog(active?.role)) return <Navigate to="/inventario" replace />;

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const [sheet, hash] = await Promise.all([readSpreadsheet(file), hashFile(file)]);
      if (sheet.rows.length === 0) throw new Error("No encontré filas con datos debajo del encabezado.");
      setLoaded({ file, hash, sheet });
      setMapping(
        suggestMapping(sheet.headers, {
          locationCodes: activeLocations.map((l) => l.code),
          defaultLocationCode: defaultLocation?.code ?? null,
          attributes: defs.map((d) => ({ key: d.key, label: d.label })),
        }),
      );
      if (jobs.some((j) => j.file_name === file.name)) toast.info("Ya importaste un archivo con ese nombre; si es el mismo contenido no se aplicará dos veces.");
    } catch (err) {
      toast.error("No se pudo leer el archivo", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const applyTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (!t || !loaded) return;
    setTemplateName(t.name);
    setMapping(Object.fromEntries(loaded.sheet.headers.map((h) => [h, (t.mapping[h] as TargetField | undefined) ?? ""])));
  };

  const setField = (header: string, field: TargetField | "") =>
    setMapping((m) => {
      const next = { ...m };
      // Un campo por columna: si otra columna lo tenía, se libera (salvo opciones, que también son únicas).
      if (field) for (const h of Object.keys(next)) if (next[h] === field) next[h] = "";
      next[header] = field;
      return next;
    });

  const runImport = () => {
    if (!loaded || !preview) return;
    const rows = preview.preview.filter((r) => r.action !== "Bloqueada").map((r) => r.payload);
    if (rows.length === 0) return toast.error("No hay filas válidas para importar");
    const skipped = preview.summary.blocked;
    if (skipped > 0 && !window.confirm(`Se importarán ${rows.length} filas. ${skipped} bloqueadas quedan fuera. ¿Continuar?`)) return;
    apply.mutate(
      { fileName: loaded.file.name, fileHash: loaded.hash, rows },
      {
        onSuccess: (r) => {
          setResult(r);
          if (r.already_applied) toast.info("Este archivo ya se había importado; no se aplicó otra vez.");
          else toast.success("Importación aplicada");
        },
        onError: (err) => toast.error("La importación no se aplicó", { description: `${err.message}. No se guardó ningún cambio.` }),
      },
    );
  };

  const downloadIssues = () => {
    if (!preview) return;
    const issues = preview.preview.filter((r) => r.errors.length || r.warnings.length);
    downloadCsv(
      "revision_importacion.csv",
      ["Fila", "Producto", "Estado", "Bloqueos", "Avisos"],
      issues.map((r) => [r.rowNumber, r.label, r.action, r.errors.join(" | "), r.warnings.join(" | ")]),
    );
  };

  const visibleRows = (preview?.preview ?? []).filter((r) =>
    filter === "blocked" ? r.action === "Bloqueada" : filter === "warnings" ? r.warnings.length > 0 : true,
  );

  return (
    <AppShell wide>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <BackLink to="/inventario">Inventario</BackLink>
          <h1 className="text-2xl">Importar y exportar</h1>
          <p className="text-sm text-muted-foreground">Carga tu catálogo y existencias desde Excel o CSV</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Rubro de la plantilla"
            value={rubroId}
            onChange={(e) => setRubroId(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            {RUBROS.map((r) => (
              <option key={r.id} value={r.id}>
                Plantilla: {r.name}
              </option>
            ))}
          </select>
          <Button variant="outline" onClick={() => downloadTemplate(RUBROS.find((r) => r.id === rubroId), locations)}>
            <Download /> Plantilla
          </Button>
          <Button
            variant="outline"
            disabled={!catalog?.rows.length}
            onClick={() =>
              exportCatalog(catalog!.rows, locations, defs, active?.tenant.slug ?? "negocio").catch((err) =>
                toast.error("No se pudo exportar", { description: (err as Error).message }),
              )
            }
          >
            <FileSpreadsheet /> Exportar catálogo
          </Button>
        </div>
      </div>

      {activeLocations.length === 0 && <Card className="p-4 text-sm">Crea al menos una sede antes de importar existencias.</Card>}

      <Card className="space-y-3 rounded-surface p-4">
        <Label htmlFor="import-file" className="mono-cap text-xs text-muted-foreground">
          1 · Archivo
        </Label>
        <div className="flex flex-wrap items-center gap-3">
          <Input id="import-file" type="file" accept=".xlsx,.csv,.txt" onChange={onFile} disabled={busy} className="max-w-sm" />
          {loaded && (
            <span className="text-sm text-muted-foreground">
              {loaded.file.name} · {loaded.sheet.rows.length} filas · {loaded.sheet.headers.length} columnas
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Una fila por producto (o por variante: talla, color…). La existencia de cada sede va en su propia columna; queda en el kardex como conteo.
        </p>
      </Card>

      {loaded && (
        <Card className="space-y-3 rounded-surface p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <p className="mono-cap text-xs text-muted-foreground">2 · Columnas</p>
            <div className="flex flex-wrap items-end gap-2">
              {templates.length > 0 && (
                <select
                  aria-label="Usar plantilla guardada"
                  defaultValue=""
                  onChange={(e) => applyTemplate(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="" disabled>
                    Usar plantilla guardada…
                  </option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}
              <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Nombre de la plantilla" className="h-9 w-56" aria-label="Nombre de la plantilla" />
              <Button
                size="sm"
                variant="outline"
                disabled={!templateName.trim() || saveTemplate.isPending}
                onClick={() =>
                  saveTemplate.mutate(
                    { name: templateName, mapping },
                    { onSuccess: () => toast.success("Plantilla guardada"), onError: (err) => toast.error("No se pudo guardar", { description: err.message }) },
                  )
                }
              >
                Guardar columnas
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Columna del archivo</TableHead>
                  <TableHead>Ejemplo</TableHead>
                  <TableHead>Se importa como</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loaded.sheet.headers.map((h) => (
                  <TableRow key={h}>
                    <TableCell className="font-medium">{h}</TableCell>
                    <TableCell className="max-w-[240px] truncate text-xs text-muted-foreground">
                      {loaded.sheet.rows.find((r) => r[h])?.[h] ?? "—"}
                    </TableCell>
                    <TableCell>
                      <select
                        aria-label={`Campo para ${h}`}
                        value={mapping[h] ?? ""}
                        onChange={(e) => setField(h, e.target.value as TargetField | "")}
                        className="h-9 w-full min-w-[220px] rounded-md border border-input bg-background px-2 text-sm"
                      >
                        <option value="">No importar</option>
                        {targetOptions.map((f) => (
                          <option key={f} value={f}>
                            {fieldLabel(f, attributeLabels)}
                          </option>
                        ))}
                      </select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {preview && (
        <Card className="space-y-3 rounded-surface p-4">
          <p className="mono-cap text-xs text-muted-foreground">3 · Revisión</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Tile label="Productos nuevos" value={preview.summary.productsCreate} />
            <Tile label="Variantes nuevas" value={preview.summary.variantsCreate} />
            <Tile label="Actualizaciones" value={preview.summary.variantsUpdate} />
            <Tile label="Existencias" value={preview.summary.stockRows} />
            <Tile label="Bloqueadas" value={preview.summary.blocked} alert={preview.summary.blocked > 0} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ["all", `Todas (${preview.summary.total})`],
                ["blocked", `Bloqueadas (${preview.summary.blocked})`],
                ["warnings", `Con avisos (${preview.summary.withWarnings})`],
              ] as const
            ).map(([k, l]) => (
              <Button key={k} size="sm" variant={filter === k ? "default" : "outline"} onClick={() => setFilter(k)}>
                {l}
              </Button>
            ))}
            {(preview.summary.blocked > 0 || preview.summary.withWarnings > 0) && (
              <Button size="sm" variant="ghost" onClick={downloadIssues}>
                <Download /> Descargar revisión
              </Button>
            )}
          </div>
          <div className="max-h-[480px] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Fila</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Acción</TableHead>
                  <TableHead>Detalle</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.slice(0, 300).map((r) => (
                  <TableRow key={r.rowNumber}>
                    <TableCell className="num">{r.rowNumber}</TableCell>
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
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {visibleRows.length > 300 && <p className="text-xs text-muted-foreground">Mostrando 300 de {visibleRows.length}.</p>}
          <div className="flex flex-wrap items-center gap-3">
            <Button className="h-12" disabled={apply.isPending || preview.summary.valid === 0} onClick={runImport}>
              <Upload /> Importar {preview.summary.valid} fila(s)
            </Button>
            <p className="text-xs text-muted-foreground">Se aplica todo o nada: si algo falla, no se guarda ningún cambio.</p>
          </div>
          {result && (
            <Card className="p-3 text-sm">
              {result.already_applied ? "Este archivo ya estaba importado. " : "Listo: "}
              {result.products_created} productos nuevos, {result.variants_created} variantes nuevas, {result.variants_updated} actualizadas,{" "}
              {result.stock_rows_applied} existencias ajustadas.
            </Card>
          )}
        </Card>
      )}

      {jobs.length > 0 && (
        <section className="space-y-2">
          <p className="mono-cap text-xs text-muted-foreground">Importaciones anteriores</p>
          <ul className="divide-y rounded-surface border bg-card">
            {jobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                <span className="font-medium">{j.file_name}</span>
                <span className="text-xs text-muted-foreground">
                  {j.total_rows} filas · {j.result.variants_created ?? 0} nuevas · {j.result.variants_updated ?? 0} actualizadas · {formatDateTime(j.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </AppShell>
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
