import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatMoney, formatQty } from "@/modules/pos/cart";
import { formatSaleDate } from "@/modules/pos/receipt";
import { useSlowMovers, useStockValue, type SlowMover, type StockValueReport } from "./api";
import { DataTable, ExportButton, Kpi, Panel, type Column } from "./components";

const DAY_OPTIONS = [30, 60, 90, 180];

const variantName = (name: string, options: Record<string, string> | null) => {
  const o = Object.values(options ?? {}).join(" · ");
  return o ? `${name} — ${o}` : name;
};

export default function StockReport({ locationId, currency }: { locationId: string | null; currency: string }) {
  const stock = useStockValue(locationId);
  const [days, setDays] = useState(60);
  const slow = useSlowMovers(days, locationId);
  const money = (v: number | null) => (v === null ? "Sin costo" : formatMoney(v, currency));

  const locs = stock.data?.by_location ?? [];
  const total = locs.reduce(
    (a, l) => ({ units: a.units + l.units, cost: a.cost + l.cost_value, retail: a.retail + l.retail_value, missing: a.missing + l.missing_cost }),
    { units: 0, cost: 0, retail: 0, missing: 0 },
  );
  const slowValue = (slow.data ?? []).reduce((a, r) => a + (r.cost_value ?? 0), 0);

  const locationCols: Column<StockValueReport["by_location"][number]>[] = [
    { header: "Sede", value: (r) => r.name },
    { header: "Productos con stock", value: (r) => r.skus, align: "right" },
    { header: "Unidades", value: (r) => r.units, render: (r) => formatQty(r.units), align: "right" },
    { header: "A costo", value: (r) => r.cost_value, render: (r) => money(r.cost_value), align: "right" },
    { header: "A precio de venta", value: (r) => r.retail_value, render: (r) => money(r.retail_value), align: "right" },
    { header: "Sin costo", value: (r) => r.missing_cost, align: "right" },
  ];
  const topCols: Column<StockValueReport["top"][number]>[] = [
    { header: "Producto", value: (r) => variantName(r.name, r.options) },
    { header: "SKU", value: (r) => r.sku },
    { header: "Unidades", value: (r) => r.units, render: (r) => formatQty(r.units), align: "right" },
    { header: "Costo", value: (r) => r.cost, render: (r) => money(r.cost), align: "right" },
    { header: "A costo", value: (r) => r.cost_value, render: (r) => money(r.cost_value), align: "right" },
    { header: "A precio", value: (r) => r.retail_value, render: (r) => (r.retail_value === null ? "Sin precio" : money(r.retail_value)), align: "right" },
  ];
  const slowCols: Column<SlowMover>[] = [
    { header: "Producto", value: (r) => variantName(r.name, r.options) },
    { header: "SKU", value: (r) => r.sku },
    { header: "Sede", value: (r) => r.location_name },
    { header: "Existencia", value: (r) => r.on_hand, render: (r) => formatQty(r.on_hand), align: "right" },
    { header: "Inmovilizado", value: (r) => r.cost_value, render: (r) => money(r.cost_value), align: "right" },
    { header: "Última venta", value: (r) => r.last_sold_at, render: (r) => (r.last_sold_at ? formatSaleDate(r.last_sold_at) : "Nunca") },
  ];

  return (
    <div className="space-y-4">
      {stock.error && <p className="text-sm text-destructive">No se pudo cargar: {stock.error.message}</p>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Stock a costo" value={money(total.cost)} hint={total.missing ? `${total.missing} productos sin costo no suman` : undefined} />
        <Kpi label="Stock a precio de venta" value={money(total.retail)} />
        <Kpi label="Unidades" value={formatQty(total.units)} />
        <Kpi label={`Sin rotación (${days} días)`} value={money(slowValue)} hint={`${slow.data?.length ?? 0} ${slow.data?.length === 1 ? "producto" : "productos"}`} />
      </div>
      <Panel title="Por sede" right={<ExportButton fileName="stock_por_sede" rows={locs} columns={locationCols} />}>
        {stock.isLoading ? <p className="mono-cap text-xs text-muted-foreground">Calculando…</p> : <DataTable rows={locs} columns={locationCols} rowKey={(r) => r.location_id} empty="Sin existencias" />}
      </Panel>
      <Panel
        title="Sin rotación"
        right={
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-xs text-muted-foreground">Sin ventas en</span>
            {DAY_OPTIONS.map((d) => (
              <Button key={d} size="sm" variant={d === days ? "default" : "outline"} onClick={() => setDays(d)}>
                {d} días
              </Button>
            ))}
            <ExportButton fileName={`sin_rotacion_${days}d`} rows={slow.data ?? []} columns={slowCols} />
          </div>
        }
      >
        <p className="text-xs text-muted-foreground">
          Productos con existencia que no se venden hace {days} días o más. No incluye lo que llegó hace menos de {days} días.
        </p>
        {slow.isLoading ? (
          <p className="mono-cap text-xs text-muted-foreground">Calculando…</p>
        ) : (
          <DataTable rows={slow.data ?? []} columns={slowCols} rowKey={(r) => `${r.variant_id}-${r.location_id}`} empty="Todo lo que tiene existencia se vendió en el periodo." />
        )}
      </Panel>
      <Panel title="Mayor valor inmovilizado (200)" right={<ExportButton fileName="stock_valorizado" rows={stock.data?.top ?? []} columns={topCols} />}>
        <DataTable rows={stock.data?.top ?? []} columns={topCols} rowKey={(r) => r.variant_id} empty="Sin existencias" />
      </Panel>
    </div>
  );
}
