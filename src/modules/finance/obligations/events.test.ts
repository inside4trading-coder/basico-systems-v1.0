import { describe, expect, it } from "vitest";
import type { ObligationEvent } from "../api";
import { describeEvent } from "./events";

const base: Omit<ObligationEvent, "action" | "detail"> = { id: "e", obligation_id: "o", instance_id: null, actor: null, created_at: "" };

describe("bitácora", () => {
  it("describe cambios de campos", () => {
    const text = describeEvent(
      { ...base, action: "updated", detail: { amount: { from: 300, to: 350 }, importance: { from: "medium", to: "critical" } } },
      "USD",
    );
    expect(text).toBe("Cambió monto: $ 300,00 → $ 350,00; importancia: Media → Crítica");
  });

  it("describe pagos parciales y anulaciones", () => {
    expect(describeEvent({ ...base, action: "instance_partial", detail: { due_date: "2026-10-05", amount: 300, paid_amount: 100 } }, "USD")).toBe(
      "Pago parcial en la cuota del 5 oct. 2026: lleva $ 100,00 de $ 300,00",
    );
    expect(describeEvent({ ...base, action: "instance_void", detail: { due_date: "2026-10-05", reason: "Duplicada" } }, "USD")).toContain("Duplicada");
    expect(describeEvent({ ...base, action: "status_paused", detail: {} }, "USD")).toBe("La pausó");
  });
});
