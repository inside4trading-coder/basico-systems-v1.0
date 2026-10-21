/**
 * Financiadora, paso 2: pagos recibidos. El archivo de pagos se cruza con el
 * estado de cuenta del banco; primero se ve el resultado y al confirmar se
 * cobra cada cuota conciliada una sola vez. Portado de CasheaPaymentsImport
 * (basicosystems@9cb08cd).
 */
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { hashFile } from "@/modules/inventory/import/files";
import { usePaymentMethods } from "@/modules/settings/api";
import { useAccounts } from "../api";
import { readBankFile } from "../bank/parse";
import { useImportFinancingPayments, type PaymentRowStatus, type PaymentsImportResult } from "./api";
import { parseFinancingPayments, type FinancingPaymentRow } from "./paymentsFile";

const STATUS: Record<PaymentRowStatus, { label: string; tone: string }> = {
  conciliado: { label: "Conciliado", tone: "border-emerald-500/50 text-emerald-700 dark:text-emerald-400" },
  posible: { label: "Posible coincidencia", tone: "border-amber-500/50 text-amber-700 dark:text-amber-400" },
  sin_banco: { label: "Sin movimiento en el banco", tone: "border-destructive/40 text-destructive" },
  sin_operacion: { label: "Sin venta con la financiadora", tone: "border-destructive/40 text-destructive" },
  pago_inicial: { label: "Pago inicial (cuota 0)", tone: "text-muted-foreground" },
  duplicado: { label: "Ya importado", tone: "text-muted-foreground" },
};

const bs = (n: number) => `Bs. ${n.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function FinancingPaymentsCard({ className }: { className?: string }) {
  const { data: accounts = [] } = useAccounts();
  const { data: methods = [] } = usePaymentMethods();
  const provider = methods.find((m) => m.kind === "bnpl" && m.is_active)?.name ?? "";
  const banks = accounts.filter((a) => a.is_active && a.kind === "bank");
  const [accountId, setAccountId] = useState<string | null>(null);
  const account = banks.find((a) => a.id === accountId) ?? banks[0] ?? null;
  const run = useImportFinancingPayments();
  const [file, setFile] = useState<{ name: string; hash: string; rows: FinancingPaymentRow[] } | null>(null);
  const [preview, setPreview] = useState<PaymentsImportResult | null>(null);
  const [reading, setReading] = useState(false);

  const call = (dry: boolean, f = file) => {
    if (!f || !account || !provider) return;
    run.mutate(
      { p_provider: provider, p_account_id: account.id, p_rows: f.rows, p_dry_run: dry, p_file_name: f.name, p_file_hash: f.hash },
      {
        onSuccess: (r) => {
          if (dry) return setPreview(r);
          toast.success(`${r.matched} ${r.matched === 1 ? "cobro conciliado" : "cobros conciliados"} con ${account.name}`, {
            description: r.possible ? `${r.possible} posibles quedan en Por identificar` : undefined,
          });
          setPreview(null);
          setFile(null);
        },
        onError: (err) => toast.error("No se pudo procesar", { description: err.message }),
      },
    );
  };

  const pick = async (f: File) => {
    setReading(true);
    try {
      const rows = parseFinancingPayments(await readBankFile(f));
      if (rows.length === 0) throw new Error("El archivo no trae pagos");
      const next = { name: f.name, hash: await hashFile(f), rows };
      setFile(next);
      call(true, next);
    } catch (err) {
      toast.error("No se pudo leer el archivo", { description: (err as Error).message });
      setFile(null);
      setPreview(null);
    } finally {
      setReading(false);
    }
  };

  return (
    <section className={cn("space-y-3 rounded-xl border bg-card p-4", className)}>
      <div>
        <h2 className="text-sm">2 · Pagos recibidos</h2>
        <p className="text-xs text-muted-foreground">
          Trae los pagos reales de los clientes: referencia, monto y cuota. Cada pago se cruza con las entradas del banco por referencia y monto en Bs (fecha ±3 días).
          Al confirmar, la línea del banco queda conciliada como cobro de la cuota, una sola vez, y sale de «Por identificar». No crea ventas ni otros ingresos.
        </p>
      </div>
      {banks.length === 0 ? (
        <p className="text-xs text-muted-foreground">Crea la cuenta bancaria donde la financiadora y sus clientes te pagan, y carga su estado de cuenta.</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="fp-account">Cuenta del banco</Label>
            <Select
              value={account?.id ?? ""}
              onValueChange={(v) => {
                setAccountId(v);
                setPreview(null);
                setFile(null);
              }}
            >
              <SelectTrigger id="fp-account" className="h-10 w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {banks.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Label
            className={cn(
              "inline-flex h-10 cursor-pointer items-center justify-center rounded-md border px-4 text-sm font-medium hover:bg-accent",
              (reading || run.isPending || !provider) && "pointer-events-none opacity-50",
            )}
          >
            {reading ? "Leyendo…" : file ? file.name : "Subir archivo de pagos"}
            <input
              type="file"
              className="sr-only"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void pick(f);
              }}
            />
          </Label>
        </div>
      )}

      {preview && (
        <div className="space-y-3 border-t pt-3">
          <div className="grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
            {(
              [
                ["Conciliados", preview.matched],
                ["Posibles", preview.possible],
                ["Sin banco", preview.no_bank],
                ["Sin venta", preview.no_operation],
                ["Iniciales", preview.initial],
                ["Ya importados", preview.duplicated],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-lg border p-2">
                <p className="mono-cap text-[10px] text-muted-foreground">{label}</p>
                <p className="num text-lg font-bold">{value}</p>
              </div>
            ))}
          </div>
          <ul className="max-h-80 space-y-2 overflow-y-auto">
            {preview.rows
              .filter((r) => r.status !== "conciliado")
              .map((r) => (
                <li key={r.row} className="rounded-md border p-2 text-xs">
                  <Badge variant="outline" className={STATUS[r.status].tone}>
                    {STATUS[r.status].label}
                  </Badge>
                  <p className="mt-1 break-words">
                    Fila {r.row} · {r.date ?? "—"} · {bs(r.amount_local)} · Ref {r.reference ?? "—"} · Orden {r.order || "—"} · Cuota {r.installment}
                  </p>
                  {r.detail && <p className="text-muted-foreground">{r.detail}</p>}
                </li>
              ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button disabled={run.isPending || preview.matched === 0} onClick={() => call(false)}>
              Confirmar {preview.matched} {preview.matched === 1 ? "conciliado" : "conciliados"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setPreview(null);
                setFile(null);
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
