/**
 * Pago a proveedor desde el banco: una salida que paga una factura de Por
 * pagar. Queda con la fecha, el monto y la referencia del banco, ya conciliada.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseAmount } from "@/modules/inventory/import/preview";
import { formatMoney } from "@/modules/pos/cart";
import { formatDay } from "../lib";
import { usePayableCandidates, usePayFromLine, type BankLine, type PayableCandidate } from "./api";

const MATCH_LABEL = { installment: "✓ monto de la próxima cuota", balance: "✓ monto del saldo" } as const;

export default function SupplierPaymentPanel({ line }: { line: BankLine }) {
  const { data, isLoading } = usePayableCandidates(line);
  const pay = usePayFromLine();
  const [showAll, setShowAll] = useState(false);
  const [applied, setApplied] = useState<Record<string, string>>({});
  const fail = (title: string) => (err: Error) => toast.error(title, { description: err.message });

  const items = data?.items ?? [];
  const matching = items.filter((c) => c.match);
  const shown = showAll || matching.length === 0 ? items : matching;

  const appliedFor = (c: PayableCandidate) => {
    if (c.currency === line.currency) return null;
    const typed = applied[c.payable_id];
    return typed !== undefined ? parseAmount(typed) : c.applied;
  };

  return (
    <section className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Facturas de proveedores abiertas. El pago queda con la fecha, el monto y la referencia del banco, ya conciliado.
        {data?.rate ? ` Tasa del día: ${data.rate.toLocaleString("es-VE", { maximumFractionDigits: 4 })}.` : ""}
      </p>
      {isLoading && <p className="mono-cap text-xs text-muted-foreground">Buscando…</p>}
      {!isLoading && items.length === 0 && <p className="text-xs text-muted-foreground">No hay facturas por pagar abiertas.</p>}
      {!isLoading && items.length > 0 && matching.length === 0 && !showAll && (
        <p className="text-xs text-muted-foreground">Ninguna coincide con el monto. Estas son las que vencen primero:</p>
      )}
      <ul className="space-y-1">
        {shown.map((c) => {
          const value = appliedFor(c);
          const invalid = c.currency !== line.currency && (value == null || Number.isNaN(value) || value <= 0);
          return (
            <li key={c.payable_id} className="space-y-2 rounded-lg border p-2">
              <div className="min-w-0 text-xs">
                <p className="truncate font-semibold">
                  {c.supplier_name}
                  {c.document ? ` · ${c.document}` : ""}
                </p>
                <p className="text-muted-foreground">
                  Falta {formatMoney(c.pending, c.currency)}
                  {c.next_pending != null && c.installments > 1 && c.next_number
                    ? ` · cuota ${c.next_number}: ${formatMoney(c.next_pending, c.currency)}`
                    : ""}
                  {c.next_due ? ` · vence ${formatDay(c.next_due)}` : ""}
                </p>
                {c.match && <p className="text-muted-foreground">{MATCH_LABEL[c.match]}</p>}
              </div>
              <div className="flex items-end gap-2">
                {c.currency !== line.currency && (
                  <div className="flex-1 space-y-1">
                    <Label htmlFor={`pa-${c.payable_id}`} className="text-xs">
                      Cubre ({c.currency})
                    </Label>
                    <Input
                      id={`pa-${c.payable_id}`}
                      inputMode="decimal"
                      className="num h-9"
                      value={applied[c.payable_id] ?? (c.applied != null ? String(c.applied) : "")}
                      onChange={(e) => setApplied((prev) => ({ ...prev, [c.payable_id]: e.target.value }))}
                    />
                  </div>
                )}
                <Button
                  size="sm"
                  className="ml-auto"
                  disabled={invalid || pay.isPending}
                  onClick={() =>
                    pay.mutate(
                      { p_line_id: line.id, p_payable_id: c.payable_id, p_applied: value },
                      { onSuccess: () => toast.success("Pago registrado y conciliado"), onError: fail("No se pudo pagar") },
                    )
                  }
                >
                  Pagar
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {!showAll && matching.length > 0 && items.length > matching.length && (
        <Button size="sm" variant="ghost" onClick={() => setShowAll(true)}>
          Ver las demás ({items.length - matching.length})
        </Button>
      )}
    </section>
  );
}
