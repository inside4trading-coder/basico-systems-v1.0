import { describe, expect, it } from "vitest";
import type { FinanceMovement } from "../api";
import { bankRef, rankCandidates } from "./match";

const mv = (id: string, amount: number, occurred_on: string, reference: string | null = null) =>
  ({ id, amount, occurred_on, reference }) as FinanceMovement;

describe("candidatos", () => {
  it("referencia normalizada como en el servidor", () => {
    expect(bankRef(" 00-0108860 ")).toBe("108860");
    expect(bankRef(null)).toBe("");
  });

  it("primero el mismo monto, luego la referencia y la fecha más cercana", () => {
    const line = { line_date: "2026-10-10", amount: 100, reference: "0055", operation_number: null };
    const ranked = rankCandidates(line, [
      mv("lejos", 100, "2026-10-01"),
      mv("otro-monto", 90, "2026-10-10", "55"),
      mv("cerca", 100, "2026-10-11"),
      mv("misma-ref", 100, "2026-10-05", "55"),
    ]);
    expect(ranked.map((c) => c.movement.id)).toEqual(["misma-ref", "cerca", "lejos", "otro-monto"]);
    expect(ranked[0]).toMatchObject({ sameAmount: true, sameReference: true, days: 5 });
  });
});
