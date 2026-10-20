import { describe, expect, it } from "vitest";
import { growers, topProfit, topSellers, type ProductSale } from "./lib";

const p = (name: string, net: number, profit: number | null = null, extra: Partial<ProductSale> = {}): ProductSale => ({
  variant_id: name,
  name,
  qty: 1,
  net,
  profit,
  costed: profit !== null,
  ...extra,
});

describe("tablero de inicio", () => {
  it("más vendidos sin conceptos manuales", () => {
    const rows = [p("A", 10), p("B", 30), p("Mano de obra", 99, null, { variant_id: null, manual: true }), p("C", 20)];
    expect(topSellers(rows, 2).map((r) => r.name)).toEqual(["B", "C"]);
  });

  it("más rentables solo con utilidad conocida y positiva", () => {
    const rows = [p("A", 10, 2), p("B", 30, null), p("C", 20, 8), p("D", 5, -1)];
    expect(topProfit(rows).map((r) => r.name)).toEqual(["C", "A"]);
  });

  it("crecen: más monto que el periodo anterior, ordenados por crecimiento", () => {
    const now = [p("A", 50), p("B", 30), p("C", 10)];
    const before = [p("A", 45), p("B", 5), p("C", 20)];
    expect(growers(now, before)).toEqual([
      { key: "B", name: "B", net: 30, previous: 5, growth: 25 },
      { key: "A", name: "A", net: 50, previous: 45, growth: 5 },
    ]);
  });
});
