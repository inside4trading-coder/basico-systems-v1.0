import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/modules/pos/cart";
import { formatSaleDate, printReceipt, storedPaper } from "@/modules/pos/receipt";
import { useCashClosures, type CashClosure } from "./api";
import { closingHtml } from "./closingPrint";
import { ExportButton, Kpi, type Column } from "./components";
import { rangeLabel, type DateRange } from "./dates";

export default function ClosuresReport({ range, locationId, currency, businessName }: {
  range: DateRange;
  locationId: string | null;
  currency: string;
  businessName: string;
}) {
  const { data = [], isLoading, error } = useCashClosures(range, locationId);
  const [open, setOpen] = useState<string | null>(null);

  if (isLoading) return <p className="mono-cap text-xs text-muted-foreground">Calculando…</p>;
  if (error) return <p className="text-sm text-destructive">No se pudo cargar: {error.message}</p>;

  const withDiff = data.filter((c) => c.has_difference);
  const stillOpen = data.filter((c) => c.status === "open");
  const currencies = [...new Set(data.flatMap((c) => c.counts.map((k) => k.currency)))].sort();
  const exportCols: Column<CashClosure>[] = [
    { header: "Sesión", value: (c) => c.number },
    { header: "Caja", value: (c) => c.register_name },
    { header: "Sede", value: (c) => c.location_name },
    { header: "Estado", value: (c) => (c.status === "closed" ? "Cerrada" : "Abierta") },
    { header: "Apertura", value: (c) => formatSaleDate(c.opened_at) },
    { header: "Cierre", value: (c) => (c.closed_at ? formatSaleDate(c.closed_at) : null) },
    { header: "Abrió", value: (c) => c.opened_by },
    { header: "Cerró", value: (c) => c.closed_by },
    { header: "Ventas", value: (c) => c.sales_count },
    { header: `Total ${currency}`, value: (c) => c.sales_total },
    ...currencies.flatMap((cur) => [
      { header: `Esperado ${cur}`, value: (c: CashClosure) => c.counts.find((k) => k.currency === cur)?.expected ?? null },
      { header: `Contado ${cur}`, value: (c: CashClosure) => c.counts.find((k) => k.currency === cur)?.counted ?? null },
      { header: `Diferencia ${cur}`, value: (c: CashClosure) => c.counts.find((k) => k.currency === cur)?.difference ?? null },
    ]),
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Sesiones" value={String(data.length)} hint={rangeLabel(range)} />
        <Kpi label="Vendido en caja" value={formatMoney(data.reduce((a, c) => a + c.sales_total, 0), currency)} />
        <Kpi label="Con diferencia" value={String(withDiff.length)} hint={withDiff.length ? "Revisa conteos y movimientos" : undefined} />
        <Kpi label="Abiertas" value={String(stillOpen.length)} />
      </div>
      <div className="flex justify-end">
        <ExportButton fileName={`cierres_${range.from}_${range.to}`} rows={data} columns={exportCols} />
      </div>
      {data.length === 0 && <p className="text-sm text-muted-foreground">No hubo cajas abiertas en el periodo.</p>}
      <ul className="space-y-2">
        {data.map((c) => (
          <li key={c.session_id} className={cn("rounded-xl border bg-card", c.has_difference && "border-destructive")}>
            <button
              type="button"
              className="flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left"
              aria-expanded={open === c.session_id}
              onClick={() => setOpen(open === c.session_id ? null : c.session_id)}
            >
              <div>
                <p className="font-semibold">
                  <span className="mono">{c.number}</span> · {c.register_name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {c.location_name} · {formatSaleDate(c.opened_at)}
                  {c.closed_at ? ` → ${formatSaleDate(c.closed_at)}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {c.status === "open" && <Badge variant="secondary">Abierta</Badge>}
                {c.has_difference && <Badge variant="destructive">Con diferencia</Badge>}
                <span className="num font-semibold">{formatMoney(c.sales_total, currency)}</span>
              </div>
            </button>
            {open === c.session_id && <ClosureDetail closure={c} currency={currency} businessName={businessName} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ClosureDetail({ closure: c, currency, businessName }: { closure: CashClosure; currency: string; businessName: string }) {
  return (
    <div className="space-y-3 border-t p-3 text-sm">
      <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
        <p>Abrió: {c.opened_by ?? "—"}</p>
        <p>Cerró: {c.closed_by ?? "—"}</p>
        <p>
          {c.sales_count} {c.sales_count === 1 ? "venta" : "ventas"}
          {c.offline_count > 0 ? ` (${c.offline_count} sin conexión)` : ""}
        </p>
        {c.closing_note && <p>Nota: {c.closing_note}</p>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              {["Efectivo", "Fondo", "Esperado", "Contado", "Diferencia"].map((h, i) => (
                <th key={h} className={cn("mono-cap px-2 py-1 text-[10px] font-normal text-muted-foreground", i > 0 && "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {c.counts.map((k) => (
              <tr key={k.currency} className="border-b last:border-0">
                <td className="px-2 py-1.5">{k.currency}</td>
                <td className="num px-2 py-1.5 text-right">{formatMoney(k.opening, k.currency)}</td>
                <td className="num px-2 py-1.5 text-right">{formatMoney(k.expected, k.currency)}</td>
                <td className="num px-2 py-1.5 text-right">{k.counted === null ? "—" : formatMoney(k.counted, k.currency)}</td>
                <td className={cn("num px-2 py-1.5 text-right", k.difference !== null && Math.abs(k.difference) >= 0.01 && "font-semibold text-destructive")}>
                  {k.difference === null ? "—" : formatMoney(k.difference, k.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {c.by_method.length > 0 && (
        <ul className="space-y-1">
          {c.by_method.map((m) => (
            <li key={`${m.method}-${m.currency}`} className="flex justify-between text-xs">
              <span>{m.method}</span>
              <span className="num">
                {formatMoney(m.amount, m.currency)}
                {m.currency !== currency ? ` · ${formatMoney(m.amount_base, currency)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Button size="sm" variant="outline" onClick={() => printReceipt(closingHtml(c, businessName, currency, storedPaper()))}>
        Imprimir cierre
      </Button>
    </div>
  );
}
