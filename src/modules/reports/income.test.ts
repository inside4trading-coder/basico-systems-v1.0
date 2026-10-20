import { describe, expect, it } from "vitest";
import { incomeLines, type IncomeReport } from "./income";

const report = (extra: Partial<IncomeReport> = {}): IncomeReport => ({
  from: "2026-10-01",
  to: "2026-10-20",
  base_currency: "USD",
  sales: { net: 1000, cost: 600, lines: 10, lines_costed: 8, returns: 100, returns_cost: 60 },
  expenses: [
    { category: "Alquiler", amount: 150 },
    { category: "Nómina", amount: 100 },
  ],
  other_income: [{ category: "Otros ingresos", amount: 20 }],
  unconverted: 0,
  ...extra,
});

describe("resultado del periodo", () => {
  it("ventas menos devoluciones y costo, menos gastos, más otros ingresos", () => {
    expect(incomeLines(report())).toEqual({
      netSales: 900,
      cost: 540,
      grossProfit: 360,
      grossMargin: 0.4,
      expenses: 250,
      otherIncome: 20,
      result: 130,
      costCoverage: 0.8,
    });
  });

  it("sin ventas no hay margen", () => {
    const r = incomeLines(report({ sales: { net: 0, cost: 0, lines: 0, lines_costed: 0, returns: null, returns_cost: null } }));
    expect(r.grossMargin).toBeNull();
    expect(r.costCoverage).toBe(1);
    expect(r.result).toBe(-230);
  });
});
