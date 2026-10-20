/**
 * Resultado del periodo: si el negocio ganó dinero. Ventas sin impuesto,
 * costo de lo vendido, gastos del libro por categoría y otros ingresos.
 * Portado de SublimeFinanciero (basicosystems@f551478b).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/modules/pos/cart";
import { Panel } from "./components";
import type { DateRange } from "./dates";
import { incomeLines, type IncomeReport as IncomeData } from "./income";

function useIncome(range: DateRange) {
  const { active } = useTenant();
  return useQuery({
    queryKey: ["reports", active?.tenant.id, "income", range.from, range.to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("report_income", { p_from: range.from, p_to: range.to });
      if (error) throw new Error(error.message);
      const r = data as IncomeData;
      const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
      return {
        ...r,
        sales: {
          net: Number(r.sales.net),
          cost: Number(r.sales.cost),
          lines: Number(r.sales.lines),
          lines_costed: Number(r.sales.lines_costed),
          returns: n(r.sales.returns),
          returns_cost: n(r.sales.returns_cost),
        },
        expenses: r.expenses.map((e) => ({ ...e, amount: Number(e.amount) })),
        other_income: r.other_income.map((e) => ({ ...e, amount: Number(e.amount) })),
      } as IncomeData;
    },
  });
}

export default function IncomeReport({ range, currency }: { range: DateRange; currency: string }) {
  const { data, isLoading, error } = useIncome(range);
  if (isLoading) return <p className="mono-cap text-xs text-muted-foreground">Calculando…</p>;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  if (!data) return null;
  const l = incomeLines(data);
  const money = (n: number) => formatMoney(n, currency);
  const pct = (n: number) => `${(n * 100).toLocaleString("es-VE", { maximumFractionDigits: 1 })} %`;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <Panel title="Resultado del periodo">
        <dl className="space-y-1 text-sm">
          <Line label="Ventas sin impuesto" value={money(data.sales.net)} />
          {(data.sales.returns ?? 0) > 0 && <Line label="− Devoluciones" value={money(data.sales.returns ?? 0)} />}
          <Line label="− Costo de lo vendido" value={money(l.cost)} />
          <Line label="= Utilidad bruta" value={money(l.grossProfit)} strong hint={l.grossMargin === null ? undefined : `margen ${pct(l.grossMargin)}`} />
          <Line label="− Gastos" value={money(l.expenses)} />
          {l.otherIncome > 0 && <Line label="+ Otros ingresos" value={money(l.otherIncome)} />}
          <Line label="= Resultado" value={money(l.result)} strong negative={l.result < 0} />
        </dl>
        {l.costCoverage < 1 && (
          <p className="mt-3 text-xs text-muted-foreground">
            {pct(1 - l.costCoverage)} de las líneas vendidas no tienen costo cargado: la utilidad real es menor. Carga el costo en Inventario.
          </p>
        )}
        {data.unconverted > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">{data.unconverted} movimiento(s) sin tasa del día quedaron fuera de los gastos.</p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Las compras de mercancía (Proveedores) no son gasto: cuentan como costo cuando se vende.
        </p>
      </Panel>
      <div className="space-y-4">
        <Panel title="Gastos por categoría">
          {data.expenses.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin gastos registrados en el periodo.</p>
          ) : (
            <dl className="space-y-1 text-sm">
              {data.expenses.map((e) => (
                <Line key={e.category} label={e.category} value={money(e.amount)} />
              ))}
            </dl>
          )}
        </Panel>
        {data.other_income.length > 0 && (
          <Panel title="Otros ingresos">
            <dl className="space-y-1 text-sm">
              {data.other_income.map((e) => (
                <Line key={e.category} label={e.category} value={money(e.amount)} />
              ))}
            </dl>
          </Panel>
        )}
      </div>
    </div>
  );
}

function Line({ label, value, strong, negative, hint }: { label: string; value: string; strong?: boolean; negative?: boolean; hint?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", strong && "border-t pt-1 font-semibold")}>
      <dt>
        {label}
        {hint && <span className="ml-2 text-xs font-normal text-muted-foreground">{hint}</span>}
      </dt>
      <dd className={cn("num", negative && "text-destructive")}>{value}</dd>
    </div>
  );
}
