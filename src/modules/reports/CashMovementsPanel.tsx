/**
 * Movimientos de efectivo de las cajas: aperturas, entradas, salidas,
 * vueltos, anulaciones y reintegros. No muestra los cobros: el detalle
 * comercial está en Ventas. Portado de SublimeCajaMovimientos
 * (basicosystems@f551478b).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";
import { formatMoney } from "@/modules/pos/cart";
import { DataTable, ExportButton, Panel, type Column } from "./components";
import { addDays, type DateRange } from "./dates";

const KIND_LABEL: Record<string, string> = {
  opening: "Apertura",
  cash_in: "Entrada",
  cash_out: "Salida",
  change: "Vuelto",
  sale_void: "Anulación",
  refund: "Reintegro",
};

interface Row {
  id: string;
  kind: string;
  currency: string;
  amount: number;
  note: string | null;
  created_at: string;
  cash_sessions: { number: string; location_id: string; registers: { name: string } | null } | null;
}

/** Inicio del día en Caracas (UTC−4, sin horario de verano) como ISO. */
const dayStart = (day: string) => `${day}T00:00:00-04:00`;

function useCashMovements(range: DateRange, locationId: string | null) {
  const { active } = useTenant();
  return useQuery({
    queryKey: ["reports", active?.tenant.id, "cash-movements", range.from, range.to, locationId],
    queryFn: async () => {
      let req = supabase
        .from("cash_movements")
        .select("id, kind, currency, amount, note, created_at, cash_sessions!inner(number, location_id, registers(name))")
        .neq("kind", "sale_cash")
        .gte("created_at", dayStart(range.from))
        .lt("created_at", dayStart(addDays(range.to, 1)))
        .order("created_at", { ascending: false })
        .limit(500);
      if (locationId) req = req.eq("cash_sessions.location_id", locationId);
      const { data, error } = await req;
      if (error) throw new Error(error.message);
      return ((data ?? []) as unknown as Row[]).map((r) => ({ ...r, amount: Number(r.amount) }));
    },
  });
}

export default function CashMovementsPanel({ range, locationId }: { range: DateRange; locationId: string | null }) {
  const { data: rows = [], isLoading } = useCashMovements(range, locationId);
  const columns: Column<Row>[] = [
    {
      header: "Fecha",
      value: (r) => new Date(r.created_at).toLocaleString("es-VE", { timeZone: "America/Caracas", dateStyle: "short", timeStyle: "short" }),
    },
    { header: "Caja", value: (r) => `${r.cash_sessions?.registers?.name ?? ""} · ${r.cash_sessions?.number ?? ""}` },
    { header: "Tipo", value: (r) => KIND_LABEL[r.kind] ?? r.kind },
    { header: "Monto", value: (r) => r.amount, render: (r) => formatMoney(r.amount, r.currency), align: "right" },
    { header: "Moneda", value: (r) => r.currency },
    { header: "Nota", value: (r) => r.note },
  ];
  return (
    <Panel title="Movimientos de efectivo" right={<ExportButton fileName={`movimientos_caja_${range.from}_${range.to}`} rows={rows} columns={columns} />}>
      {isLoading ? (
        <p className="mono-cap text-xs text-muted-foreground">Cargando…</p>
      ) : (
        <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} empty="Sin aperturas, entradas ni salidas en el periodo." />
      )}
    </Panel>
  );
}
