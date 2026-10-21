/**
 * IVA del periodo: base imponible e IVA de lo vendido por tasa, menos
 * devoluciones. Es el débito fiscal que se declara; el IGTF va aparte.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";
import { formatMoney } from "@/modules/pos/cart";
import { DataTable, ExportButton, Kpi, Panel, type Column } from "./components";
import type { DateRange } from "./dates";
import { taxRows, taxTotals, type TaxReportData, type TaxRow } from "./taxRows";

function useTaxReport(range: DateRange, locationId: string | null) {
  const { active } = useTenant();
  return useQuery({
    queryKey: ["reports", active?.tenant.id, "tax", range.from, range.to, locationId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("report_tax", { p_from: range.from, p_to: range.to, p_location_id: locationId });
      if (error) throw new Error(error.message);
      return data as TaxReportData;
    },
  });
}

export default function TaxReport({ range, locationId, currency }: { range: DateRange; locationId: string | null; currency: string }) {
  const { data, isLoading, error } = useTaxReport(range, locationId);
  if (isLoading) return <p className="mono-cap text-xs text-muted-foreground">Calculando…</p>;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  if (!data) return null;
  const rows = taxRows(data);
  const totals = taxTotals(rows);
  const money = (n: number) => formatMoney(n, currency);
  const columns: Column<TaxRow>[] = [
    { header: "Tasa", value: (r) => (r.rate > 0 ? `${r.rate} %` : "Exento") },
    { header: "Base vendida", value: (r) => r.base, render: (r) => money(r.base), align: "right" },
    { header: "IVA vendido", value: (r) => r.tax, render: (r) => money(r.tax), align: "right" },
    { header: "Base devuelta", value: (r) => r.returnsBase, render: (r) => (r.returnsBase ? `−${money(r.returnsBase)}` : "—"), align: "right" },
    { header: "IVA devuelto", value: (r) => r.returnsTax, render: (r) => (r.returnsTax ? `−${money(r.returnsTax)}` : "—"), align: "right" },
    { header: "Base neta", value: (r) => r.netBase, render: (r) => money(r.netBase), align: "right" },
    { header: "IVA neto", value: (r) => r.netTax, render: (r) => <b>{money(r.netTax)}</b>, align: "right" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="IVA del periodo" value={money(totals.tax)} hint="Débito fiscal: vendido menos devuelto" />
        <Kpi label="Base gravada" value={money(totals.taxable)} />
        <Kpi label="Ventas exentas" value={money(totals.exempt)} />
        <Kpi label="IGTF percibido" value={money(Number(data.igtf))} hint={`${data.tickets} venta(s) cobradas`} />
      </div>
      <Panel title="IVA por tasa" right={<ExportButton fileName={`iva-${range.from}-${range.to}`} rows={rows} columns={columns} />}>
        <DataTable rows={rows} columns={columns} rowKey={(r) => String(r.rate)} empty="Sin ventas en el periodo" />
        <p className="mt-3 text-xs text-muted-foreground">
          Sale de cada venta cobrada (las anuladas no cuentan). Las devoluciones restan en el periodo en que se hicieron. Compara con tu
          contador antes de declarar: no incluye el IVA de las compras (crédito fiscal).
        </p>
      </Panel>
    </div>
  );
}
