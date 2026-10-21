/**
 * Carga del reporte de órdenes de la financiadora: crea o actualiza las cuentas
 * por cobrar y sus cuotas. Se usa en Por cobrar y en el centro de conciliación.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { hashFile } from "@/modules/inventory/import/files";
import { usePaymentMethods, useTenantSettings } from "@/modules/settings/api";
import { readBankFile } from "../bank/parse";
import { useImportFinancing, useProviderLedger, useReceivables } from "./api";
import { parseFinancingTable, type FinancingRow } from "./financingFile";

interface Preview {
  fileName: string;
  hash: string;
  rows: FinancingRow[];
  skipped: number;
}

export default function FinancingImportCard({ className }: { className?: string }) {
  const { data: receivables = [] } = useReceivables();
  const { data: ledger = [] } = useProviderLedger();
  const { data: methods = [] } = usePaymentMethods();
  const { data: settings } = useTenantSettings();
  const importFinancing = useImportFinancing();
  const base = settings?.base_currency ?? "USD";

  const providers = useMemo(() => {
    const names = new Set<string>();
    methods.filter((m) => m.kind === "bnpl").forEach((m) => names.add(m.name));
    receivables.forEach((r) => r.provider && names.add(r.provider));
    ledger.forEach((e) => names.add(e.provider));
    return [...names].sort();
  }, [methods, receivables, ledger]);

  const [provider, setProvider] = useState<string | null>(null);
  const importProvider = provider ?? providers[0] ?? "";
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reading, setReading] = useState(false);
  const [lastIssues, setLastIssues] = useState<{ row: number; reason: string }[]>([]);

  const pickFile = async (file: File) => {
    setReading(true);
    try {
      const { rows, skipped } = parseFinancingTable(await readBankFile(file));
      setPreview({ fileName: file.name, hash: await hashFile(file), rows, skipped });
    } catch (err) {
      toast.error("No se pudo leer el archivo", { description: (err as Error).message });
      setPreview(null);
    } finally {
      setReading(false);
    }
  };

  const confirmImport = () => {
    if (!preview || !importProvider) return;
    importFinancing.mutate(
      { p_provider: importProvider, p_file_name: preview.fileName, p_file_hash: preview.hash, p_rows: preview.rows.map((r) => ({ ...r, currency: base })) },
      {
        onSuccess: (r) => {
          toast.success(`${r.created} nuevas · ${r.updated} actualizadas · ${r.linked} vinculadas a ventas del POS`, {
            description: r.issues.length ? `${r.issues.length} filas con avisos` : undefined,
          });
          setLastIssues(r.issues);
          setPreview(null);
        },
        onError: (err) => toast.error("No se pudo cargar", { description: err.message }),
      },
    );
  };

  return (
    <section className={cn("space-y-3 rounded-xl border bg-card p-4", className)}>
      <div>
        <h2 className="text-sm">Cargar reporte de la financiadora</h2>
        <p className="text-xs text-muted-foreground">
          El reporte de órdenes (Excel o CSV) trae n.º de orden, cuotas y estados. Se une con las ventas del POS cobradas con ese método por número de venta o de
          orden; las que no estén se crean.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="fin-provider">Financiadora</Label>
          {providers.length > 0 ? (
            <Select value={importProvider} onValueChange={setProvider}>
              <SelectTrigger id="fin-provider" className="h-10 w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input id="fin-provider" className="h-10 w-48" value={provider ?? ""} onChange={(e) => setProvider(e.target.value)} placeholder="Nombre" />
          )}
        </div>
        <Label
          className={cn(
            "inline-flex h-10 cursor-pointer items-center justify-center rounded-md border px-4 text-sm font-medium hover:bg-accent",
            (!importProvider || reading) && "pointer-events-none opacity-50",
          )}
        >
          {reading ? "Leyendo…" : "Elegir archivo"}
          <input
            type="file"
            className="sr-only"
            accept=".xlsx,.csv,.xls"
            disabled={!importProvider || reading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void pickFile(f);
            }}
          />
        </Label>
      </div>
      {preview && (
        <div className="space-y-2 rounded-lg border p-3 text-xs">
          <p className="text-sm font-semibold">{preview.fileName}</p>
          <p>
            {preview.rows.length} órdenes · {preview.rows.reduce((a, r) => a + r.installments.length, 0)} cuotas
            {preview.skipped ? ` · ${preview.skipped} filas sin orden ni factura` : ""}
          </p>
          {(() => {
            // Comparación con lo cargado: órdenes nuevas y órdenes que se actualizan.
            const known = new Set(receivables.filter((r) => r.provider === importProvider && r.external_ref).map((r) => r.external_ref));
            const existing = preview.rows.filter((r) => r.external_ref && known.has(r.external_ref)).length;
            return (
              <p className="text-muted-foreground">
                Contra lo cargado: {preview.rows.length - existing} nuevas · {existing} ya estaban (se actualizan cuotas y estados)
              </p>
            );
          })()}
          <ul className="divide-y rounded border">
            {preview.rows.slice(0, 5).map((r, i) => (
              <li key={i} className="flex justify-between gap-2 p-2">
                <span className="min-w-0 truncate">
                  Orden {r.external_ref ?? "—"} · {r.document ?? "sin factura"} · {r.customer_name ?? "—"}
                </span>
                <span className="shrink-0">{r.installments.length} cuotas</span>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button size="sm" disabled={preview.rows.length === 0 || importFinancing.isPending} onClick={confirmImport}>
              Cargar en {importProvider}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPreview(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
      {lastIssues.length > 0 && (
        <ul className="max-h-32 space-y-0.5 overflow-y-auto text-xs text-muted-foreground">
          {lastIssues.map((i, k) => (
            <li key={k}>
              Fila {i.row}: {i.reason}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
