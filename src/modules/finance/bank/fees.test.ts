import { describe, expect, it } from "vitest";
import { feeSuggestions, ruleMatches } from "./fees";

describe("comisiones del banco", () => {
  it("frase al inicio o en cualquier parte, sin importar mayúsculas", () => {
    expect(ruleMatches({ phrase: "COM. PAGO MOVIL", match: "starts", is_active: true }, "com. pago movil 0412")).toBe(true);
    expect(ruleMatches({ phrase: "COM. PAGO MOVIL", match: "starts", is_active: true }, "Dev COM. PAGO MOVIL")).toBe(false);
    expect(ruleMatches({ phrase: "mantenimiento", match: "contains", is_active: true }, "Cargo por MANTENIMIENTO")).toBe(true);
  });

  it("sugiere salidas abiertas que parecen comisión y no tienen frase", () => {
    const lines = [
      { direction: "out" as const, status: "unmatched", description: "COM PAGO MOVIL 1" },
      { direction: "out" as const, status: "possible", description: "Com pago movil 2" },
      { direction: "out" as const, status: "unmatched", description: "ITF 0,75%" },
      { direction: "out" as const, status: "matched", description: "COM PAGO MOVIL 3" },
      { direction: "in" as const, status: "unmatched", description: "COM devuelta" },
      { direction: "out" as const, status: "unmatched", description: "Pago proveedor" },
      { direction: "out" as const, status: "unmatched", description: "CARGO MANTENIMIENTO" },
    ];
    expect(feeSuggestions(lines, [{ phrase: "cargo", match: "starts", is_active: true }])).toEqual([
      { phrase: "COM PAGO MOVIL", count: 2 },
      { phrase: "ITF 0,75%", count: 1 },
    ]);
  });
});
