/**
 * Cobranza desde el banco: una entrada que paga la cuota de un cliente
 * (Cashea o crédito). Portado de
 * CasheaBankRecoveryDrawer (AdminCashea.tsx, basicosystems@f551478b).
 */
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/modules/pos/cart";
import { parseAmount } from "@/modules/inventory/import/preview";
import { formatDay } from "../lib";
import { useCollectFromLine, useReceivableCandidates, type BankLine, type ReceivableCandidate } from "./api";

const MATCH_LABEL = { installment: "✓ monto de la próxima cuota", balance: "✓ monto del saldo" } as const;

function who(c: ReceivableCandidate) {
  const name = c.customer_name ?? "Sin nombre";
  return c.provider ? `${name} · ${c.provider}${c.external_ref ? ` #${c.external_ref}` : ""}` : `${name}${c.document ? ` · ${c.document}` : ""}`;
}

export default function CollectionPanel({ line }: { line: BankLine }) {
  const { data, isLoading } = useReceivableCandidates(line);
  const collect = useCollectFromLine();
  const [showAll, setShowAll] = useState(false);
  const [applied, setApplied] = useState<Record<string, string>>({});
  const fail = (title: string) => (err: Error) => toast.error(title, { description: err.message });

  const items = data?.items ?? [];
  const matching = items.filter((c) => c.match);
  const shown = showAll || matching.length === 0 ? items : matching;

  const appliedFor = (c: ReceivableCandidate) => {
    if (c.currency === line.currency) return null;
    const typed = applied[c.receivable_id];
    return typed !== undefined ? parseAmount(typed) : c.applied;
  };

  return (
    <section className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Cuentas por cobrar abiertas. El cobro queda con la fecha, el monto y la referencia del banco, ya conciliado.
        {data?.rate ? ` Tasa del día: ${data.rate.toLocaleString("es-VE", { maximumFractionDigits: 4 })}.` : ""}
      </p>
      {isLoading && <p className="mono-cap text-xs text-muted-foreground">Buscando…</p>}
      {!isLoading && items.length === 0 && <p className="text-xs text-muted-foreground">No hay cuentas por cobrar abiertas.</p>}
      {!isLoading && items.length > 0 && matching.length === 0 && !showAll && (
        <p className="text-xs text-muted-foreground">Ninguna coincide con el monto. Estas son las más cercanas:</p>
      )}
      <ul className="space-y-1">
        {shown.map((c) => {
          const value = appliedFor(c);
          const invalid = c.currency !== line.currency && (value == null || Number.isNaN(value) || value <= 0);
          return (
            <li key={c.receivable_id} className="space-y-2 rounded-lg border p-2">
              <div className="min-w-0 text-xs">
                <p className="truncate font-semibold">{who(c)}</p>
                <p className="text-muted-foreground">
                  Falta {formatMoney(c.pending, c.currency)}
                  {c.next_number && c.next_pending != null
                    ? ` · cuota ${c.next_number}: ${formatMoney(c.next_pending, c.currency)}${c.next_due ? ` (${formatDay(c.next_due)})` : ""}`
                    : ""}
                </p>
                {c.match && <p className="text-muted-foreground">{MATCH_LABEL[c.match]}</p>}
              </div>
              <div className="flex items-end gap-2">
                {c.currency !== line.currency && (
                  <div className="flex-1 space-y-1">
                    <Label htmlFor={`ap-${c.receivable_id}`} className="text-xs">
                      Cubre ({c.currency})
                    </Label>
                    <Input
                      id={`ap-${c.receivable_id}`}
                      inputMode="decimal"
                      className="num h-9"
                      value={applied[c.receivable_id] ?? (c.applied != null ? String(c.applied) : "")}
                      onChange={(e) => setApplied((prev) => ({ ...prev, [c.receivable_id]: e.target.value }))}
                    />
                  </div>
                )}
                <Button
                  size="sm"
                  className="ml-auto"
                  disabled={invalid || collect.isPending}
                  onClick={() =>
                    collect.mutate(
                      { p_line_id: line.id, p_receivable_id: c.receivable_id, p_applied: value },
                      { onSuccess: () => toast.success("Cobro registrado y conciliado"), onError: fail("No se pudo cobrar") },
                    )
                  }
                >
                  Cobrar
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
