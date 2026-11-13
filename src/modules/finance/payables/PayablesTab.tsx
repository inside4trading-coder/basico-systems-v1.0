/**
 * Por pagar: facturas de proveedores a crédito, con cuotas, pagos parciales,
 * notas de crédito y la antigüedad de la deuda.
 */
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTenant } from "@/core/tenant-context";
import { cn } from "@/lib/utils";
import { downloadXlsx } from "@/modules/inventory/import/files";
import { formatMoney } from "@/modules/pos/cart";
import { caracasToday } from "@/modules/reports/dates";
import { useTenantSettings } from "@/modules/settings/api";
import { useAccounts } from "../api";
import { formatDay } from "../lib";
import { usePayables, usePayablesSummary } from "./api";
import { NewPayableDialog, SuppliersDialog } from "./dialogs";
import {
  dueLabel,
  isPayableOverdue,
  matchesPayableFilter,
  matchesPayableSearch,
  nextPayableDue,
  PAYABLE_FILTER_LABEL,
  PAYABLE_STATUS_LABEL,
  payableLeft,
  type PayableFilter,
} from "./lib";
import PayableSheet from "./PayableSheet";

const AGING: { key: "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus"; label: string }[] = [
  { key: "current", label: "Al día" },
  { key: "d1_30", label: "1–30 días" },
  { key: "d31_60", label: "31–60 días" },
  { key: "d61_90", label: "61–90 días" },
  { key: "d90_plus", label: "Más de 90" },
];

export default function PayablesTab() {
  const { can } = useTenant();
  const operator = can("finanzas.operar");
  const today = caracasToday();
  const { data: payables = [], isLoading, error } = usePayables();
  const { data: summary } = usePayablesSummary();
  const { data: accounts = [] } = useAccounts();
  const { data: settings } = useTenantSettings();
  const usable = accounts.filter((a) => a.is_active);
  const base = settings?.base_currency ?? "USD";

  const [filter, setFilter] = useState<PayableFilter>("open");
  const [query, setQuery] = useState("");
  const [supplierId, setSupplierId] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"new" | "suppliers" | null>(null);

  const supplierOptions = useMemo(() => {
    const map = new Map<string, string>();
    payables.forEach((p) => map.set(p.supplier_id, p.supplier?.name ?? "—"));
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [payables]);
  const bySupplier = payables.filter((p) => supplierId === "all" || p.supplier_id === supplierId);
  const counts = useMemo(() => {
    const c = {} as Record<PayableFilter, number>;
    (Object.keys(PAYABLE_FILTER_LABEL) as PayableFilter[]).forEach((f) => (c[f] = bySupplier.filter((p) => matchesPayableFilter(p, f, today)).length));
    return c;
  }, [bySupplier, today]);
  const shown = bySupplier.filter((p) => matchesPayableFilter(p, filter, today) && matchesPayableSearch(p, query));
  const opened = payables.find((p) => p.id === openId) ?? null;
  const agingMax = Math.max(...AGING.map((a) => summary?.aging[a.key] ?? 0), 0);

  const exportRows = () =>
    downloadXlsx(
      `por_pagar_${today}.xlsx`,
      ["Proveedor", "RIF", "Factura", "Control", "Emisión", "Vence", "Categoría", "Moneda", "Base", "IVA", "Total", "Pagado", "Pendiente", "Estado"],
      shown.map((p) => [
        p.supplier?.name ?? null,
        p.supplier?.tax_id ?? null,
        p.document,
        p.control_number,
        p.issued_on,
        nextPayableDue(p.installments)?.due_date ?? null,
        p.category,
        p.currency,
        p.subtotal,
        p.tax_amount,
        p.amount,
        p.paid,
        payableLeft(p),
        p.status === "open" ? (isPayableOverdue(p, today) ? "Vencida" : "Abierta") : PAYABLE_STATUS_LABEL[p.status],
      ]),
      "Por pagar",
    );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Por pagar" value={formatMoney(summary?.total ?? 0, base)} hint={`${summary?.open ?? 0} ${summary?.open === 1 ? "factura abierta" : "facturas abiertas"}`} strong />
        <Kpi
          label="Vencido"
          value={formatMoney(summary?.overdue_total ?? 0, base)}
          hint={`${summary?.overdue_count ?? 0} ${summary?.overdue_count === 1 ? "cuota" : "cuotas"}`}
          negative={(summary?.overdue_count ?? 0) > 0}
        />
        <Kpi label="Vence en 7 días" value={formatMoney(summary?.due_7_total ?? 0, base)} />
        <Kpi label="Vence en 30 días" value={formatMoney(summary?.due_30_total ?? 0, base)} />
      </div>
      {summary && summary.unconverted > 0 && (
        <p className="text-xs text-muted-foreground">Hay {summary.unconverted} cuota(s) en otra moneda sin tasa: no entran en los totales.</p>
      )}

      {summary && summary.total > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          <section className="space-y-2 rounded-xl border bg-card p-3" aria-label="Antigüedad de la deuda">
            <h2 className="mono-cap text-[10px] text-muted-foreground">Antigüedad de la deuda</h2>
            <ul className="space-y-1.5 text-xs">
              {AGING.map((a) => {
                const value = summary.aging[a.key];
                return (
                  <li key={a.key} className="grid grid-cols-[6rem_1fr_auto] items-center gap-2">
                    <span className="text-muted-foreground">{a.label}</span>
                    <span className="h-2 overflow-hidden rounded-full bg-muted">
                      <span
                        className={cn("block h-full rounded-full", a.key === "current" ? "bg-primary" : "bg-destructive")}
                        style={{ width: `${agingMax > 0 ? (value / agingMax) * 100 : 0}%` }}
                      />
                    </span>
                    <span className="num font-semibold">{formatMoney(value, base)}</span>
                  </li>
                );
              })}
            </ul>
          </section>
          <section className="space-y-2 rounded-xl border bg-card p-3" aria-label="Deuda por proveedor">
            <h2 className="mono-cap text-[10px] text-muted-foreground">Por proveedor</h2>
            <ul className="divide-y text-xs">
              {summary.suppliers.slice(0, 6).map((s) => (
                <li key={s.supplier_id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 py-1.5 text-left hover:text-primary"
                    onClick={() => {
                      setSupplierId(s.supplier_id);
                      setFilter("open");
                    }}
                  >
                    <span className="min-w-0 truncate">{s.name}</span>
                    <span className="num shrink-0">
                      {formatMoney(s.total, base)}
                      {s.overdue > 0 && <span className="text-destructive"> · vencido {formatMoney(s.overdue, base)}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {operator && (
          <Button size="sm" onClick={() => setDialog("new")}>
            Nueva factura
          </Button>
        )}
        {operator && (
          <Button size="sm" variant="outline" onClick={() => setDialog("suppliers")}>
            Proveedores
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={shown.length === 0} onClick={exportRows}>
          Excel
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Estado">
          {(Object.keys(PAYABLE_FILTER_LABEL) as PayableFilter[]).map((f) => (
            <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)} aria-pressed={filter === f}>
              {PAYABLE_FILTER_LABEL[f]} ({counts[f]})
            </Button>
          ))}
        </div>
        <Select value={supplierId} onValueChange={setSupplierId}>
          <SelectTrigger className="h-9 w-48" aria-label="Proveedor">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los proveedores</SelectItem>
            {supplierOptions.map(([id, name]) => (
              <SelectItem key={id} value={id}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="search"
          aria-label="Buscar por pagar"
          placeholder="Proveedor, RIF o factura"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-9 min-w-0 flex-1 basis-48"
        />
      </div>

      {isLoading && <p className="mono-cap text-xs text-muted-foreground">Cargando…</p>}
      {error && <p className="text-sm text-destructive">No se pudo cargar: {error.message}</p>}
      {!isLoading && !error && payables.length === 0 && (
        <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          Aquí van las facturas de proveedores que pagas después: a crédito o en cuotas. Registra la primera con «Nueva factura».
        </div>
      )}
      {!isLoading && payables.length > 0 && shown.length === 0 && <p className="text-sm text-muted-foreground">Nada en este filtro.</p>}
      <ul className="space-y-2">
        {shown.map((p) => {
          const next = nextPayableDue(p.installments);
          const late = isPayableOverdue(p, today);
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setOpenId(p.id)}
                className={cn("flex w-full items-center justify-between gap-2 rounded-xl border bg-card p-3 text-left hover:bg-accent", late && "border-destructive/50")}
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold">{p.supplier?.name ?? "Proveedor"}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.document ? `Factura ${p.document}` : "Sin n.º de factura"} · {formatDay(p.issued_on)}
                    {p.category !== "Proveedores" ? ` · ${p.category}` : ""}
                    {p.installments.length > 1 ? ` · ${p.installments.length} cuotas` : ""}
                  </p>
                  {p.status === "open" && next && (
                    <p className={cn("text-xs", late ? "font-semibold text-destructive" : "text-muted-foreground")}>
                      {dueLabel(next.due_date, today)} ({formatDay(next.due_date)})
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="num font-semibold">{formatMoney(p.status === "open" ? payableLeft(p) : p.amount, p.currency)}</span>
                  {p.status === "open" && p.paid > 0 && <span className="num text-[11px] text-muted-foreground">de {formatMoney(p.amount, p.currency)}</span>}
                  {p.status !== "open" && <Badge variant="secondary">{PAYABLE_STATUS_LABEL[p.status]}</Badge>}
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {dialog === "new" && <NewPayableDialog onClose={() => setDialog(null)} />}
      {dialog === "suppliers" && <SuppliersDialog onClose={() => setDialog(null)} />}
      <PayableSheet key={opened?.id} payable={opened} accounts={usable} onClose={() => setOpenId(null)} />
    </div>
  );
}

function Kpi({ label, value, hint, strong, negative }: { label: string; value: string; hint?: string; strong?: boolean; negative?: boolean }) {
  return (
    <div className={cn("min-w-0 rounded-xl border bg-card p-3", strong && "border-primary/40")}>
      <p className="mono-cap text-[10px] text-muted-foreground">{label}</p>
      <p className={cn("num text-lg font-bold leading-tight", negative && "text-destructive")}>{value}</p>
      {hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
