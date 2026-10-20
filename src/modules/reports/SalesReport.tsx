import { formatMoney, formatQty, round2 } from "@/modules/pos/cart";
import { useSalesReport, type SalesReport } from "./api";
import { ColumnChart, DataTable, ExportButton, Kpi, Panel, type Column } from "./components";
import { pct, rangeDays, rangeLabel, type DateRange } from "./dates";

export default function SalesReportView({ range, locationId, currency }: { range: DateRange; locationId: string | null; currency: string }) {
  const { data, isLoading, error } = useSalesReport(range, locationId);
  if (isLoading) return <p className="mono-cap text-xs text-muted-foreground">Calculando…</p>;
  if (error) return <p className="text-sm text-destructive">No se pudo cargar: {error.message}</p>;
  if (!data) return null;

  const money = (v: number) => formatMoney(v, currency);
  const s = data.summary;
  const p = data.previous;
  const profit = round2(s.net_costed - s.cost);
  const prevProfit = round2(p.net_costed - p.cost);
  const coverage = s.lines ? s.lines_costed / s.lines : 0;
  const singleDay = rangeDays(range) === 1;
  const tag = `${range.from}_${range.to}`;

  const productCols: Column<SalesReport["by_product"][number]>[] = [
    { header: "Producto", value: (r) => (r.manual ? `${r.name} (concepto)` : r.name) },
    { header: "SKU", value: (r) => r.sku },
    { header: "Unidades", value: (r) => r.qty, render: (r) => formatQty(r.qty), align: "right" },
    { header: "Ventas", value: (r) => r.net, render: (r) => money(r.net), align: "right" },
    { header: "Utilidad", value: (r) => r.profit, render: (r) => (r.costed && r.profit !== null ? money(r.profit) : "Sin costo"), align: "right" },
  ];
  const locationCols: Column<SalesReport["by_location"][number]>[] = [
    { header: "Sede", value: (r) => r.name },
    { header: "Tickets", value: (r) => r.tickets, align: "right" },
    { header: "Ventas", value: (r) => r.net, render: (r) => money(r.net), align: "right" },
    { header: "Participación", value: (r) => (s.net ? round2((r.net / s.net) * 100) : 0), render: (r) => (s.net ? pct(r.net / s.net) : "—"), align: "right" },
  ];
  const methodCols: Column<SalesReport["by_method"][number]>[] = [
    { header: "Método", value: (r) => r.method },
    { header: "Pagos", value: (r) => r.count, align: "right" },
    { header: "Cobrado", value: (r) => r.amount, render: (r) => formatMoney(r.amount, r.currency), align: "right" },
    { header: `Equivale ${currency}`, value: (r) => r.amount_base, render: (r) => money(r.amount_base), align: "right" },
  ];
  const sellerCols: Column<SalesReport["by_seller"][number]>[] = [
    { header: "Cajero", value: (r) => r.seller },
    { header: "Tickets", value: (r) => r.tickets, align: "right" },
    { header: "Ventas", value: (r) => r.net, render: (r) => money(r.net), align: "right" },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {rangeLabel(range)} · comparado con los {rangeDays(range)} {rangeDays(range) === 1 ? "día anterior" : "días anteriores"}
      </p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Ventas netas" value={money(s.net)} current={s.net} previous={p.net} />
        <Kpi label="Tickets" value={String(s.tickets)} current={s.tickets} previous={p.tickets} />
        <Kpi label="Ticket promedio" value={s.tickets ? money(s.net / s.tickets) : "—"} current={s.tickets ? s.net / s.tickets : undefined} previous={p.tickets ? p.net / p.tickets : undefined} />
        <Kpi label="Unidades" value={formatQty(s.units)} current={s.units} previous={p.units} />
        <Kpi
          label="Utilidad conocida"
          value={s.lines_costed ? money(profit) : "—"}
          current={s.lines_costed ? profit : undefined}
          previous={p.lines_costed ? prevProfit : undefined}
          hint={`Sin impuesto · ${s.lines_costed} de ${s.lines} líneas con costo`}
        />
        <Kpi label="Margen" value={s.net_costed ? pct(profit / s.net_costed) : "—"} hint={s.lines ? `Cobertura de costo ${pct(coverage)}` : undefined} />
        <Kpi label="Descuentos" value={money(s.discount)} current={s.discount} previous={p.discount} invert />
        <Kpi label="Impuesto" value={money(s.tax)} hint={s.igtf > 0 ? `IGTF percibido ${money(s.igtf)}` : undefined} />
      </div>
      {((s.returns ?? 0) > 0 || (s.voided ?? 0) > 0) && (
        <p className="text-xs text-muted-foreground">
          {(s.returns ?? 0) > 0
            ? `${s.returns} ${s.returns === 1 ? "devolución" : "devoluciones"} por ${money(Number(s.returns_total ?? 0))}: ventas menos devoluciones ${money(s.net - Number(s.returns_total ?? 0))}. `
            : ""}
          {(s.voided ?? 0) > 0 ? `${s.voided} ${s.voided === 1 ? "venta anulada" : "ventas anuladas"} (no cuentan).` : ""}
        </p>
      )}
      {s.offline > 0 && (
        <p className="text-xs text-muted-foreground">
          {s.offline} {s.offline === 1 ? "venta se cobró" : "ventas se cobraron"} sin conexión y se registraron después.
        </p>
      )}
      {coverage < 1 && s.lines > 0 && (
        <p className="text-xs text-muted-foreground">
          La utilidad y el margen solo cuentan productos con costo cargado. Carga los costos en Inventario para verlos completos.
        </p>
      )}

      {singleDay ? (
        <Panel title="Ventas por hora">
          <ColumnChart
            data={data.by_hour}
            x="hour"
            y="net"
            formatX={(h) => `${String(h).padStart(2, "0")}:00`}
            formatY={money}
            label="Ventas netas por hora del día"
          />
        </Panel>
      ) : (
        <Panel title="Ventas por día">
          <ColumnChart
            data={data.by_day}
            x="day"
            y="net"
            formatX={(d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("es-VE", { day: "numeric", month: "short", timeZone: "UTC" })}
            formatY={money}
            label="Ventas netas por día"
          />
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Por sede" right={<ExportButton fileName={`ventas_sede_${tag}`} rows={data.by_location} columns={locationCols} />}>
          <DataTable rows={data.by_location} columns={locationCols} rowKey={(r) => r.location_id} />
        </Panel>
        <Panel title="Por método de pago" right={<ExportButton fileName={`ventas_metodo_${tag}`} rows={data.by_method} columns={methodCols} />}>
          <DataTable rows={data.by_method} columns={methodCols} rowKey={(r) => `${r.method}-${r.currency}`} />
        </Panel>
      </div>
      <Panel title="Por producto (100 que más venden)" right={<ExportButton fileName={`ventas_producto_${tag}`} rows={data.by_product} columns={productCols} />}>
        <DataTable rows={data.by_product} columns={productCols} rowKey={(r) => r.variant_id ?? `manual-${r.name}`} />
      </Panel>
      <Panel title="Por cajero" right={<ExportButton fileName={`ventas_cajero_${tag}`} rows={data.by_seller} columns={sellerCols} />}>
        <DataTable rows={data.by_seller} columns={sellerCols} rowKey={(r) => r.seller} />
      </Panel>
    </div>
  );
}
