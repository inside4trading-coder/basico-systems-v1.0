/**
 * Aliados: lo vendido por encargo que hay que pagarle a cada aliado al costo.
 * Se marca pagado en bloque y, si un producto no tenía costo, se completa aquí.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useTenant } from "@/core/tenant-context";
import { formatMoney } from "@/modules/pos/cart";
import { formatQty } from "@/modules/inventory/lib";
import { useTenantSettings } from "@/modules/settings/api";
import { totalsByPartner, useMarkPartnerPaid, usePartnerPayables, useSetPartnerCost, type PayableStatus } from "./api";

const STATUS_LABEL: Record<PayableStatus, string> = { pending: "Por pagar", paid: "Pagados", cancelled: "Anulados" };

export default function PartnerPayablesTab() {
  const { can } = useTenant();
  const { data: settings } = useTenantSettings();
  const base = settings?.base_currency ?? "USD";
  const [status, setStatus] = useState<PayableStatus>("pending");
  const [partner, setPartner] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { data: rows = [], isLoading, error } = usePartnerPayables(status);
  const markPaid = useMarkPartnerPaid();
  const setCost = useSetPartnerCost();
  const editable = can("finanzas.operar") && status === "pending";

  const totals = totalsByPartner(rows);
  const visible = partner === "all" ? rows : rows.filter((r) => r.location_id === partner);
  const chosen = visible.filter((r) => selected.has(r.id));
  const chosenTotal = Math.round(chosen.reduce((a, r) => a + (r.amount ?? 0), 0) * 100) / 100;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const pay = () =>
    markPaid.mutate(
      chosen.map((r) => r.id),
      {
        onSuccess: (n) => {
          toast.success(`${n} encargo${n === 1 ? "" : "s"} marcado${n === 1 ? "" : "s"} como pagado${n === 1 ? "" : "s"}`);
          setSelected(new Set());
        },
        onError: (err) => toast.error("No se pudo marcar", { description: err.message }),
      },
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(STATUS_LABEL) as PayableStatus[]).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={status === s ? "default" : "outline"}
            onClick={() => {
              setStatus(s);
              setSelected(new Set());
            }}
          >
            {STATUS_LABEL[s]}
          </Button>
        ))}
      </div>

      {totals.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {totals.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setPartner(partner === t.id ? "all" : t.id)}
              aria-pressed={partner === t.id}
              className={`rounded-surface border p-3 text-left transition-colors hover:border-primary ${partner === t.id ? "border-primary" : "bg-card"}`}
            >
              <p className="text-sm text-muted-foreground">{t.name}</p>
              <p className="num text-xl font-semibold">{formatMoney(t.amount, base)}</p>
              {t.missingCost > 0 && <p className="text-xs text-destructive">{t.missingCost} sin costo</p>}
            </button>
          ))}
        </div>
      )}

      <Card className="overflow-x-auto rounded-surface">
        {error ? (
          <p className="p-4 text-sm text-destructive">{(error as Error).message}</p>
        ) : isLoading ? (
          <p className="mono-cap p-4 text-xs text-muted-foreground">Cargando…</p>
        ) : visible.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            {status === "pending"
              ? "No hay nada pendiente con aliados. Cuando el POS venda un producto por encargo, aparece aquí con su costo."
              : `No hay encargos ${STATUS_LABEL[status].toLowerCase()}.`}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                {editable && <th className="w-8 p-3" />}
                <th className="p-3 font-medium">Fecha</th>
                <th className="p-3 font-medium">Venta</th>
                <th className="p-3 font-medium">Aliado</th>
                <th className="p-3 font-medium">Producto</th>
                <th className="p-3 text-right font-medium">Cant.</th>
                <th className="p-3 text-right font-medium">Costo</th>
                <th className="p-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  {editable && (
                    <td className="p-3">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={selected.has(r.id)}
                        onChange={() => toggle(r.id)}
                        aria-label={`Elegir ${r.item?.description ?? "encargo"}`}
                      />
                    </td>
                  )}
                  <td className="whitespace-nowrap p-3">{new Date(r.sale?.sold_at ?? r.created_at).toLocaleDateString("es-VE")}</td>
                  <td className="mono whitespace-nowrap p-3 text-xs">{r.sale?.number}</td>
                  <td className="p-3">{r.location?.name}</td>
                  <td className="p-3">
                    {r.item?.description}
                    {r.item?.sku && <span className="mono ml-2 text-xs text-muted-foreground">{r.item.sku}</span>}
                  </td>
                  <td className="num p-3 text-right">{formatQty(r.qty)}</td>
                  <td className="num p-3 text-right">
                    {r.unit_cost === null && editable ? (
                      <Input
                        inputMode="decimal"
                        placeholder="Costo"
                        aria-label="Costo unitario"
                        className="ml-auto h-8 w-24 text-right"
                        onBlur={(e) => {
                          const n = Number(e.target.value.replace(",", "."));
                          if (!e.target.value.trim()) return;
                          if (Number.isNaN(n) || n < 0) return toast.error("Escribe un costo válido");
                          setCost.mutate({ id: r.id, cost: n }, { onError: (err) => toast.error("No se pudo guardar", { description: err.message }) });
                        }}
                      />
                    ) : r.unit_cost === null ? (
                      <Badge variant="outline">Sin costo</Badge>
                    ) : (
                      formatMoney(r.unit_cost, base)
                    )}
                  </td>
                  <td className="num p-3 text-right font-semibold">{r.amount === null ? "—" : formatMoney(r.amount, base)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {editable && chosen.length > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <p className="text-sm">
            {chosen.length} elegido{chosen.length === 1 ? "" : "s"} · <span className="num font-semibold">{formatMoney(chosenTotal, base)}</span>
          </p>
          <Button onClick={pay} disabled={markPaid.isPending}>
            Marcar pagado
          </Button>
        </div>
      )}
    </div>
  );
}
