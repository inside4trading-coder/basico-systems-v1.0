/**
 * Importador de catálogo para cualquier Excel, pensado para quien no es
 * digital. Se usa en Inventario → Importar y exportar y dentro del paso
 * «Tus productos» del alta:
 *   1. se sube el archivo (hojas y fila de títulos se detectan solas),
 *   2. «Así entendimos tu archivo»: cinco productos de muestra; cada campo se
 *      corrige tocando la columna correcta; dos preguntas (IVA y sede),
 *   3. importar (todo o nada).
 * Lo técnico (fila de títulos, más campos, reglas, formatos, revisión fila por
 * fila) queda en «Opciones avanzadas». El formato se guarda y se aplica solo.
 */
import { useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { useTaxRates } from "@/modules/settings/api";
import { ChevronDown, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTenant } from "@/core/tenant-context";
import { useCatalog, useLocations } from "../api";
import { ensureAttributes, useApplyImport, useAttributeDefs, useImportJobs, useImportTemplates, useSaveImportTemplate, type ImportResult } from "./api";
import { downloadTemplate } from "./exportCatalog";
import ConfirmStep from "./ConfirmStep";
import FieldMapper from "./FieldMapper";
import { downloadXlsx, hashFile, readWorkbook, sha256Hex } from "./files";
import { normalizedTable } from "./normalized";
import { buildSheetsPreview, groupIssues, type CatalogIndexEntry } from "./preview";
import ReviewStep from "./ReviewStep";
import { RUBROS } from "./rubros";
import { effectiveRules, initSheet, moveStockTo, pendingAttributes, stockColumn, withHeaderRow, type MappingContext, type SheetState } from "./sheetState";
import SheetStep from "./SheetStep";
import { findFormat, readTemplate, signatureOf, similarity, toTemplate } from "./templates";

interface LoadedFile {
  file: File;
  hash: string;
}

export default function CatalogImporter({
  embedded = false,
  onImported,
}: {
  /** Dentro del alta: ofrece la plantilla a quien no tiene Excel. */
  embedded?: boolean;
  /** Después de aplicar una importación nueva. */
  onImported?: (result: ImportResult) => void;
}) {
  const { can } = useTenant();
  const { data: catalog } = useCatalog();
  const { data: locations = [] } = useLocations();
  const { data: defs = [] } = useAttributeDefs();
  const { data: templates = [] } = useImportTemplates();
  const { data: jobs = [] } = useImportJobs();
  const { data: taxRates = [] } = useTaxRates();
  const saveTemplate = useSaveImportTemplate();
  const apply = useApplyImport();

  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [sheets, setSheets] = useState<SheetState[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [templateName, setTemplateName] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  // Respuestas de la confirmación: si el precio trae IVA y en qué sede está cada hoja.
  const [ivaAnswered, setIvaAnswered] = useState(false);
  const [sedeAnswered, setSedeAnswered] = useState<Record<string, boolean>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [missing, setMissing] = useState("");

  const activeLocations = useMemo(() => locations.filter((l) => l.is_active), [locations]);
  const defaultLocation = activeLocations.find((l) => l.sells_in_pos && l.type === "store") ?? activeLocations[0];
  const taxRate = taxRates.find((t) => t.is_default)?.rate ?? 0;
  const mappingCtx: MappingContext = {
    locationCodes: activeLocations.map((l) => l.code),
    defaultLocationCode: defaultLocation?.code ?? null,
    attributes: defs.map((d) => ({ key: d.key, label: d.label })),
  };
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

  const included = sheets.filter((s) => s.include);
  const pending = useMemo(() => pendingAttributes(sheets, defs.map((d) => d.key)), [sheets, defs]);

  const preview = useMemo(() => {
    if (included.length === 0) return null;
    return buildSheetsPreview(
      included.map((s) => ({
        name: s.name,
        rows: s.parsed.rows,
        rowNumbers: s.parsed.rowNumbers,
        mapping: s.mapping,
        rules: effectiveRules(s),
      })),
      {
        catalog: index,
        locationCodes: activeLocations.map((l) => l.code),
        attributes: [...defs.map((d) => ({ key: d.key, multi: d.multi })), ...pending.map((p) => ({ key: p.key, multi: false }))],
        taxRate,
      },
    );
  }, [included, index, activeLocations, defs, pending, taxRate]);

  if (!can("catalogo.editar")) return null;

  const updateSheet = (i: number, patch: Partial<SheetState>) =>
    setSheets((all) =>
      all.map((s, k) => {
        if (k !== i) return s;
        if (patch.headerIndex != null && patch.headerIndex !== s.headerIndex) {
          const redone = withHeaderRow(s, patch.headerIndex, mappingCtx);
          return { ...redone, ...patch, parsed: redone.parsed, mapping: redone.mapping };
        }
        return { ...s, ...patch };
      }),
    );

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const [raw, hash] = await Promise.all([readWorkbook(file), hashFile(file)]);
      const applied = new Set<string>();
      const answered: Record<string, boolean> = {};
      const next = raw
        .filter((r) => r.table.length > 0)
        .map((r) => {
          const guess = initSheet(r, mappingCtx);
          const found = findFormat(templates, guess.parsed.headers);
          if (!found) return guess;
          applied.add(found.template.name);
          answered[r.name] = true;
          setTemplateName(found.template.name);
          return initSheet(r, mappingCtx, found.format);
        });
      if (!next.some((s) => s.include)) throw new Error("No encontré filas con datos en ninguna hoja.");
      setLoaded({ file, hash });
      setSheets(next);
      setIvaAnswered(applied.size > 0);
      setSedeAnswered(answered);
      setMissing("");
      setShowDetail(false);
      setActiveSheet(Math.max(0, next.findIndex((s) => s.include)));
      if (applied.size) toast.success(`Se aplicó el formato guardado «${Array.from(applied).join("», «")}»`);
      if (jobs.some((j) => j.file_name === file.name)) toast.info("Ya importaste un archivo con ese nombre; si es el mismo contenido no se aplicará dos veces.");
    } catch (err) {
      toast.error("No se pudo leer el archivo", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const applyTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    const formats = readTemplate(t.mapping).sheets;
    setTemplateName(t.name);
    setSheets((all) =>
      all.map((s) => {
        if (!s.include) return s;
        const format =
          formats.find((f) => f.name && f.name === s.name) ??
          [...formats].sort((a, b) => similarity(signatureOf(s.parsed.headers), b.signature) - similarity(signatureOf(s.parsed.headers), a.signature))[0];
        return format ? initSheet({ name: s.name, table: s.table }, mappingCtx, format) : s;
      }),
    );
  };

  const saveFormat = () =>
    saveTemplate.mutate(
      {
        name: templateName,
        template: toTemplate(
          included.map((s) => ({
            name: s.name,
            headerRow: s.headerIndex + 1,
            signature: signatureOf(s.parsed.headers),
            columns: s.mapping,
            rules: s.rules,
          })),
        ),
      },
      { onSuccess: () => toast.success("Formato guardado"), onError: (err) => toast.error("No se pudo guardar", { description: err.message }) },
    );

  const runImport = async () => {
    if (!loaded || !preview) return;
    if (!ivaAnswered) return setMissing("Responde si el precio ya incluye IVA.");
    const noSede = included.find((s) => activeLocations.length > 1 && stockColumn(s.mapping) && !sedeAnswered[s.name]);
    if (noSede) return setMissing(`Responde en qué sede está la mercancía${included.length > 1 ? ` de ${noSede.name}` : ""}.`);
    setMissing("");
    const valid = preview.preview.filter((r) => r.action !== "Bloqueada");
    if (valid.length === 0) return toast.error("No hay filas válidas para importar");
    const skipped = preview.summary.blocked;
    if (skipped > 0 && !window.confirm(`Se importarán ${valid.length} filas. ${skipped} bloqueadas quedan fuera. ¿Continuar?`)) return;
    // Filas numeradas 1..N para el servidor; sus mensajes se traducen a hoja y fila del archivo.
    const rows = valid.map((r, i) => ({ ...r.payload, row_number: i + 1 }));
    const where = (n: number) => {
      const r = valid[n - 1];
      if (!r) return `Fila ${n}`;
      return included.length > 1 ? `Hoja ${r.sheet}, fila ${r.rowNumber}` : `Fila ${r.rowNumber}`;
    };
    // La huella incluye hojas y cruce: otra hoja del mismo archivo es otra importación.
    const config = JSON.stringify(included.map((s) => [s.name, s.headerIndex, s.mapping, effectiveRules(s)]));
    const fileHash = await sha256Hex(new TextEncoder().encode(`${loaded.hash}|${config}`));
    try {
      await ensureAttributes(pending, defs.map((d) => d.key));
    } catch (err) {
      return toast.error("No se pudieron crear los datos extra", { description: (err as Error).message });
    }
    apply.mutate(
      { fileName: loaded.file.name, fileHash, rows },
      {
        onSuccess: (r) => {
          setResult(r);
          if (r.already_applied) toast.info("Este archivo ya se había importado; no se aplicó otra vez.");
          else toast.success("Importación aplicada");
          if (!r.already_applied) onImported?.(r);
        },
        onError: (err) =>
          toast.error("La importación no se aplicó", {
            description: `${err.message.replace(/Fila (\d+)/g, (_, n: string) => where(Number(n)))}. No se guardó ningún cambio.`,
          }),
      },
    );
  };

  const downloadNormalized = () => {
    if (!preview) return;
    const { headers, data } = normalizedTable(preview.preview, {
      attributeLabels: { ...attributeLabels, ...Object.fromEntries(pending.map((p) => [p.key, p.label])) },
      locationCodes: activeLocations.map((l) => l.code),
    });
    const base = loaded?.file.name.replace(/\.[^.]+$/, "") ?? "importacion";
    downloadXlsx(`${base}_normalizado.xlsx`, headers, data).catch((err) => toast.error("No se pudo descargar", { description: (err as Error).message }));
  };

  const current = sheets[activeSheet];
  const multiSheet = included.length > 1;
  const totalRows = sheets.reduce((n, s) => n + (s.include ? s.parsed.rows.length : 0), 0);
  const blocking = preview ? groupIssues(preview.preview).filter((g) => g.blocking) : [];
  const answerIva = (yes: boolean) => {
    setSheets((all) => all.map((s) => ({ ...s, rules: { ...s.rules, pricesIncludeTax: yes } })));
    setIvaAnswered(true);
    setMissing("");
  };
  const answerSede = (code: string) => {
    if (!current) return;
    updateSheet(activeSheet, { mapping: moveStockTo(current.mapping, code) });
    setSedeAnswered((a) => ({ ...a, [current.name]: true }));
    setMissing("");
  };
  const currentStock = current ? stockColumn(current.mapping) : null;

  return (
    <div className="space-y-4">
      {activeLocations.length === 0 && <Card className="p-4 text-sm">Crea al menos una sede antes de importar existencias.</Card>}

      <Card className="space-y-3 rounded-surface p-4">
        <Label htmlFor="import-file" className="mono-cap text-xs text-muted-foreground">
          1 · Tu archivo
        </Label>
        <Input id="import-file" type="file" accept=".xlsx,.csv,.txt" onChange={onFile} disabled={busy} className="max-w-sm" />
        {loaded ? (
          <>
            <p className="text-sm">
              {loaded.file.name} · {sheets.length} {sheets.length === 1 ? "hoja" : "hojas"} · {totalRows} productos
            </p>
            {sheets.length > 1 && (
              <div className="flex flex-wrap gap-4">
                {sheets.map((s, i) => (
                  <label key={s.name + i} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={s.include} onChange={(e) => updateSheet(i, { include: e.target.checked })} />
                    {s.name} <span className="text-xs text-muted-foreground">({s.parsed.rows.length})</span>
                  </label>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Sirve cualquier Excel o CSV, con una fila por producto.{" "}
            {embedded && (
              <button type="button" className="underline" onClick={() => downloadTemplate(RUBROS[0], locations)}>
                ¿No tienes uno? Baja la plantilla
              </button>
            )}
          </p>
        )}
      </Card>

      {current && included.length > 0 && (
        <Card className="space-y-4 rounded-surface p-4">
          <div>
            <p className="mono-cap text-xs text-muted-foreground">2 · Así entendimos tu archivo</p>
            <p className="text-sm text-muted-foreground">Si algo no cuadra, toca «Cambiar» en esa columna.</p>
          </div>
          {multiSheet && (
            <div className="flex flex-wrap gap-2">
              {sheets.map((s, i) =>
                s.include ? (
                  <Button key={s.name + i} size="sm" variant={i === activeSheet ? "default" : "outline"} onClick={() => setActiveSheet(i)}>
                    {s.name}
                  </Button>
                ) : null,
              )}
            </div>
          )}
          {current.include ? (
            <ConfirmStep
              key={`${current.name}|${activeSheet}|${current.headerIndex}`}
              sheet={current}
              defaultLocation={defaultLocation?.code ?? null}
              onChange={(patch) => updateSheet(activeSheet, patch)}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Esta hoja no se importa.</p>
          )}

          <Question title={`¿El precio ya incluye IVA${taxRate > 0 ? ` (${taxRate} %)` : ""}?`}>
            <Choice selected={ivaAnswered && current.rules.pricesIncludeTax} onClick={() => answerIva(true)}>
              Sí, ya lo incluye
            </Choice>
            <Choice selected={ivaAnswered && !current.rules.pricesIncludeTax} onClick={() => answerIva(false)}>
              No, se le suma
            </Choice>
          </Question>

          {activeLocations.length > 1 && currentStock && (
            <Question title={`¿En qué sede está esta mercancía${multiSheet ? ` (${current.name})` : ""}?`}>
              {activeLocations.map((l) => (
                <Choice key={l.id} selected={Boolean(sedeAnswered[current.name]) && currentStock.location === l.code} onClick={() => answerSede(l.code)}>
                  {l.name}
                </Choice>
              ))}
            </Question>
          )}
        </Card>
      )}

      {preview && (
        <Card className="space-y-3 rounded-surface p-4">
          <p className="mono-cap text-xs text-muted-foreground">3 · Importar</p>
          <p className="text-sm">
            Se cargarán <span className="num font-medium">{preview.summary.valid}</span> productos
            {preview.summary.skipped > 0 && <span className="text-muted-foreground"> · {preview.summary.skipped} filas sin nombre se saltan</span>}.
          </p>
          {blocking.length > 0 && (
            <ul className="space-y-1 text-sm text-destructive">
              {blocking.slice(0, 3).map((g) => (
                <li key={g.kind}>
                  {g.count} {g.count === 1 ? "fila no se puede" : "filas no se pueden"} importar: {g.kind}
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => setShowDetail((v) => !v)} className="text-xs text-muted-foreground underline">
            {showDetail ? "Ocultar detalle" : "Ver detalle fila por fila"}
          </button>
          {showDetail && <ReviewStep preview={preview.preview} summary={preview.summary} multiSheet={multiSheet} onDownloadNormalized={downloadNormalized} />}
          <div className="flex flex-wrap items-center gap-3">
            <Button className="h-12 px-6 text-base" disabled={apply.isPending} onClick={runImport}>
              <Upload /> Se ve bien, importar {preview.summary.valid} productos
            </Button>
            <p className="text-xs text-muted-foreground">Todo o nada: si algo falla, no se guarda ningún cambio.</p>
          </div>
          {missing && (
            <p className="text-sm text-destructive" role="alert">
              {missing}
            </p>
          )}
          {preview.summary.generatedSkus > 0 && (catalog?.rows.length ?? 0) > 0 && (
            <p className="text-xs text-muted-foreground">
              Los productos con SKU generado se crean nuevos. Para actualizarlos más adelante, usa «Exportar catálogo» o el archivo normalizado.
            </p>
          )}
          {result && (
            <Card className="p-3 text-sm">
              {result.already_applied ? "Este archivo ya estaba importado. " : "Listo: "}
              {result.products_created} productos nuevos, {result.variants_created} variantes nuevas, {result.variants_updated} actualizadas,{" "}
              {result.stock_rows_applied} existencias ajustadas.
            </Card>
          )}
        </Card>
      )}

      {current && included.length > 0 && (
        <Card className="space-y-4 rounded-surface p-4">
          <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronDown className={`h-4 w-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`} /> Opciones avanzadas
          </button>
          {showAdvanced && (
            <div className="space-y-6">
              <section className="space-y-2">
                <p className="mono-cap text-xs text-muted-foreground">Formato guardado</p>
                <div className="flex flex-wrap items-end gap-2">
                  {templates.length > 0 && (
                    <select
                      aria-label="Usar formato guardado"
                      value=""
                      onChange={(e) => applyTemplate(e.target.value)}
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="" disabled>
                        Usar formato guardado…
                      </option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Nombre del formato" className="h-9 w-48" aria-label="Nombre del formato" />
                  <Button size="sm" variant="outline" disabled={!templateName.trim() || saveTemplate.isPending} onClick={saveFormat}>
                    Guardar formato
                  </Button>
                  <Button size="sm" variant="ghost" onClick={downloadNormalized}>
                    <Download /> Descargar normalizado
                  </Button>
                </div>
              </section>
              <section className="space-y-2">
                <p className="mono-cap text-xs text-muted-foreground">Fila de títulos</p>
                <SheetStep sheets={sheets} onChange={updateSheet} />
              </section>
              {current.include && (
                <section className="space-y-2">
                  <p className="mono-cap text-xs text-muted-foreground">Todos los campos{multiSheet ? ` · ${current.name}` : ""}</p>
                  <FieldMapper
                    key={current.name + activeSheet}
                    sheet={current}
                    locations={activeLocations.map((l) => ({ code: l.code, name: l.name }))}
                    attributes={defs.map((d) => ({ key: d.key, label: d.label }))}
                    taxRate={taxRate}
                    onChange={(patch) => updateSheet(activeSheet, patch)}
                  />
                </section>
              )}
            </div>
          )}
        </Card>
      )}

    </div>
  );
}

function Question({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="font-medium">{title}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Choice({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button type="button" variant={selected ? "default" : "outline"} className="h-11 px-5" aria-pressed={selected} onClick={onClick}>
      {children}
    </Button>
  );
}
