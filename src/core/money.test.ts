import { describe, expect, it } from "vitest";
import { currencySymbol, formatMoney, formatRateDate } from "./money";

describe("montos", () => {
  it("la divisa se muestra como REF, nunca $", () => {
    expect(currencySymbol("USD")).toBe("REF");
    expect(formatMoney(12.98, "USD")).toBe("REF 12,98");
    expect(formatMoney(1234.5, "USD")).not.toContain("$");
  });

  it("el bolívar se muestra como Bs.", () => {
    expect(formatMoney(11466.48, "VES")).toBe("Bs. 11.466,48");
  });

  it("otras monedas salen con su código", () => {
    expect(formatMoney(5, "EUR")).toBe("EUR 5,00");
  });

  it("vacío cuenta como cero", () => {
    expect(formatMoney(null, "USD")).toBe("REF 0,00");
  });

  it("fecha corta de la tasa", () => {
    expect(formatRateDate("2026-10-21")).toMatch(/^21 oct/);
  });
});
