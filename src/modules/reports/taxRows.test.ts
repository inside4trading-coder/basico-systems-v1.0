import { describe, expect, it } from "vitest";
import { taxRows, taxTotals } from "./taxRows";

describe("reporte de IVA", () => {
  const data = {
    sales: [
      { rate: 16, base: 200, tax: 32, lines: 4 },
      { rate: 0, base: 30, tax: 0, lines: 2 },
    ],
    returns: [{ rate: 16, base: 10, tax: 1.6 }],
  };

  it("resta las devoluciones de cada tasa", () => {
    expect(taxRows(data)).toEqual([
      { rate: 16, base: 200, tax: 32, returnsBase: 10, returnsTax: 1.6, netBase: 190, netTax: 30.4 },
      { rate: 0, base: 30, tax: 0, returnsBase: 0, returnsTax: 0, netBase: 30, netTax: 0 },
    ]);
  });

  it("separa base gravada, exenta e IVA a pagar", () => {
    expect(taxTotals(taxRows(data))).toEqual({ taxable: 190, exempt: 30, tax: 30.4 });
  });

  it("una tasa con solo devoluciones también aparece", () => {
    const rows = taxRows({ sales: [], returns: [{ rate: 8, base: 5, tax: 0.4 }] });
    expect(rows).toEqual([{ rate: 8, base: 0, tax: 0, returnsBase: 5, returnsTax: 0.4, netBase: -5, netTax: -0.4 }]);
  });
});
