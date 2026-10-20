/** Resultado del periodo: cuentas a partir de report_income. */

export interface IncomeReport {
  from: string;
  to: string;
  base_currency: string;
  sales: { net: number; cost: number; lines: number; lines_costed: number; returns: number | null; returns_cost: number | null };
  expenses: { category: string; amount: number }[];
  other_income: { category: string; amount: number }[];
  unconverted: number;
}

export interface IncomeLines {
  netSales: number;
  cost: number;
  grossProfit: number;
  grossMargin: number | null;
  expenses: number;
  otherIncome: number;
  result: number;
  /** Proporción de líneas vendidas con costo conocido (0 a 1). */
  costCoverage: number;
}

export function incomeLines(r: IncomeReport): IncomeLines {
  const netSales = r.sales.net - (r.sales.returns ?? 0);
  const cost = r.sales.cost - (r.sales.returns_cost ?? 0);
  const grossProfit = netSales - cost;
  const expenses = r.expenses.reduce((a, e) => a + e.amount, 0);
  const otherIncome = r.other_income.reduce((a, e) => a + e.amount, 0);
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    netSales: round(netSales),
    cost: round(cost),
    grossProfit: round(grossProfit),
    grossMargin: netSales > 0 ? grossProfit / netSales : null,
    expenses: round(expenses),
    otherIncome: round(otherIncome),
    result: round(grossProfit - expenses + otherIncome),
    costCoverage: r.sales.lines > 0 ? r.sales.lines_costed / r.sales.lines : 1,
  };
}
