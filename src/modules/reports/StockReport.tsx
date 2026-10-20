import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatMoney, formatQty } from "@/modules/pos/cart";
import { useStockHealth, useStockValue, type StockHealthRow, type StockSegment, type StockValueReport } from "./api";
import { DataTable, ExportButton, Kpi, Panel, type Column } from "./components";
import { rowAmount, rowsInSegment, SEGMENTS, segmentLabel } from "./stockHealth";

const DAY_OPTIONS = [30, 60, 90];
const COVER_OPTIONS = [7, 15, 30];

const variantName = (name: string, options: Record<string, string> | null) => {
  const o = Object.values(options ?? {}).join(" · ");
  return o ? `${name} — ${o}` : name;
};

const restockLink = (locationId: string | null) => `/control?tab=reposicion${locationId ? `&sede=${locationId}` : ""}`;

export default function StockReport({ locationId, currency }: { locationId: string | null; currency: string }) {
  const stock = useStockValue(locationId);
  const [days, setDays] = useState(30);
  const [cover, setCover] = useState(15);
  const [segment, setSegment] = useState<StockSegment | null>(null);
  const health = useStockHealth(locationId, days, cover);
  const money = (v: number | null) => (v === null ? "Sin costo" : formatMoney(v, currency));

  const locs = stock.data?.by_location ?? [];
  const total = locs.reduce(
    (a, l) => ({ units: a.units + l.units, cost: a.cost + l.cost_value, retail: a.retail + l.retail_value, missing: a.missing + l.missing_cost }),
    { units: 0, cost: 0, retail: 0, missing: 0 },
  );
  const summary = health.data?.summary;
  const slow = summary?.sin_rotacion;
  const rows = rowsInSegment(health.data?.rows ?? [], segment);
  const current = SEGMENTS.find((s) => s.key === segment);
  const atCost = (r: StockHealthRow) => SEGMENTS.find((s) => s.key === (segment ?? r.segment))?.atCost ?? false;

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
  const healthCols: Column<StockHealthRow>[] = [
    { header: "Producto", value: (r) => variantName(r.name, r.options), render: (r) => <span className="font-semibold">{variantName(r.name, r.options)}</span> },
    { header: "SKU", value: (r) => r.sku },
    { header: "Sede", value: (r) => r.location_name },
    { header: "Clase", value: (r) => r.abc_class, align: "right" },
    { header: "Venta diaria", value: (r) => r.daily, render: (r) => formatQty(r.daily), align: "right" },
    { header: "Disponible", value: (r) => r.available, render: (r) => formatQty(r.available), align: "right" },
    { header: "Cobertura", value: (r) => r.cover, render: (r) => (r.cover === null ? "—" : `${formatQty(r.cover)} d`), align: "right" },
    {
      header: "Sugerido",
      value: (r) => r.suggested,
      render: (r) =>
        r.suggested ? (
          <Link to={restockLink(r.location_id)} className="font-semibold text-primary underline-offset-2 hover:underline" title="Ver en Reposición">
            {formatQty(r.suggested)}
          </Link>
        ) : (
          "—"
        ),
      align: "right",
    },
    { header: "Segmento", value: (r) => r.segments.map(segmentLabel).join(", "), render: (r) => segmentLabel(segment ?? r.segment) },
    {
      header: current ? current.amountLabel.charAt(0).toUpperCase() + current.amountLabel.slice(1) : "Monto",
      value: (r) => rowAmount(r, segment),
      render: (r) => {
        const v = rowAmount(r, segment);
        return v === null ? <span className="text-muted-foreground">{atCost(r) ? "Sin costo" : "Sin precio"}</span> : money(v);
      },
      align: "right",
    },
  ];

  return (
    <div className="space-y-4">
      {stock.error && <p className="text-sm text-destructive">No se pudo cargar: {stock.error.message}</p>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Stock a costo" value={money(total.cost)} hint={total.missing ? `${total.missing} productos sin costo no suman` : undefined} />
        <Kpi label="Stock a precio de venta" value={money(total.retail)} />
        <Kpi label="Unidades" value={formatQty(total.units)} />
        <Kpi label={`Sin rotación (${days} días)`} value={money(slow?.amount ?? 0)} hint={`${slow?.count ?? 0} ${slow?.count === 1 ? "producto" : "productos"}`} />
      </div>

      <Panel
        title="Salud del inventario"
        right={
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-xs text-muted-foreground">Ventas de</span>
            {DAY_OPTIONS.map((d) => (
              <Button key={d} size="sm" variant={d === days ? "default" : "outline"} onClick={() => setDays(d)}>
                {d} días
              </Button>
            ))}
            <span className="ml-2 text-xs text-muted-foreground">Cubrir</span>
            {COVER_OPTIONS.map((d) => (
              <Button key={d} size="sm" variant={d === cover ? "default" : "outline"} onClick={() => setCover(d)}>
                {d} días
              </Button>
            ))}
          </div>
        }
      >
        <p className="text-xs text-muted-foreground">
          Cruza lo vendido en los últimos {days} días con lo disponible en cada sede. Clase A, B y C por venta (80 %, 15 % y el resto). Toca una tarjeta para
          filtrar la tabla.
        </p>
        {health.error && <p className="text-sm text-destructive">No se pudo cargar: {health.error.message}</p>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {SEGMENTS.map((s) => {
            const info = summary?.[s.key];
            const active = segment === s.key;
            return (
              <button
                key={s.key}
                type="button"
                aria-pressed={active}
                onClick={() => setSegment(active ? null : s.key)}
                className={cn("rounded-xl border bg-card p-3 text-left hover:border-primary/40", active && "border-primary bg-primary/5")}
              >
                <p className="mono-cap text-[10px] text-muted-foreground">{s.label}</p>
                <p className="num text-xl font-bold">{health.isLoading ? "…" : formatQty(info?.count ?? 0)}</p>
                <p className="num text-xs">
                  {money(info?.amount ?? 0)} <span className="text-muted-foreground">{s.amountLabel}</span>
                </p>
                <p className="text-xs text-muted-foreground">{s.describe(days, cover)}</p>
                {!!info?.missing && (
                  <p className="text-xs text-muted-foreground">
                    {info.missing} sin {s.atCost ? "costo" : "precio"} no suman
                  </p>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm">
              {current ? current.label : "Todo lo que pide atención"} ({rows.length}
              {!segment && health.data && health.data.total > rows.length ? ` de ${health.data.total}` : ""})
            </h3>
            {segment && (
              <Button size="sm" variant="ghost" onClick={() => setSegment(null)}>
                Ver todo
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Button size="sm" variant="outline" asChild>
              <Link to={restockLink(locationId)}>Crear pedido</Link>
            </Button>
            <ExportButton fileName={`salud_inventario_${segment ?? "todo"}_${days}d`} rows={rows} columns={healthCols} />
          </div>
        </div>
        {health.isLoading ? (
          <p className="mono-cap text-xs text-muted-foreground">Calculando…</p>
        ) : (
          <DataTable rows={rows} columns={healthCols} rowKey={(r) => `${r.variant_id}-${r.location_id}`} empty="Nada en este segmento." />
        )}
      </Panel>

      <Panel title="Por sede" right={<ExportButton fileName="stock_por_sede" rows={locs} columns={locationCols} />}>
        {stock.isLoading ? <p className="mono-cap text-xs text-muted-foreground">Calculando…</p> : <DataTable rows={locs} columns={locationCols} rowKey={(r) => r.location_id} empty="Sin existencias" />}
      </Panel>
      <Panel title="Mayor valor inmovilizado (200)" right={<ExportButton fileName="stock_valorizado" rows={stock.data?.top ?? []} columns={topCols} />}>
        <DataTable rows={stock.data?.top ?? []} columns={topCols} rowKey={(r) => r.variant_id} empty="Sin existencias" />
      </Panel>
    </div>
  );
}
