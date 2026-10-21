import { describe, expect, it } from "vitest";
import type { LinkCandidate } from "../api";
import { matchesCandidate, shiftDay } from "./linkPayment";

const m: LinkCandidate = {
  id: "1",
  occurred_on: "2026-10-16",
  account_id: "a",
  account_name: "Banco Operativa",
  amount: 39000,
  currency: "VES",
  category: "Servicios",
  counterparty: "Internet Plus",
  reference: "927842011",
  note: null,
  allocated: 0,
  linked_here: false,
};

describe("enlazar pagos", () => {
  it("corre fechas sin saltos por zona horaria", () => {
    expect(shiftDay("2026-10-10", -15)).toBe("2026-09-25");
    expect(shiftDay("2026-12-20", 15)).toBe("2027-01-04");
  });

  it("busca por referencia, monto, concepto, cuenta o moneda", () => {
    expect(matchesCandidate(m, "")).toBe(true);
    expect(matchesCandidate(m, "92784")).toBe(true);
    expect(matchesCandidate(m, "39000")).toBe(true);
    expect(matchesCandidate(m, "internet")).toBe(true);
    expect(matchesCandidate(m, "operativa")).toBe(true);
    expect(matchesCandidate(m, "ves")).toBe(true);
    expect(matchesCandidate(m, "zelle")).toBe(false);
  });
});
