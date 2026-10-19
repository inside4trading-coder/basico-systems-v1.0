import { describe, expect, it } from "vitest";
import { addMonths, daysFrom, dueState, monthGrid, monthRange, obligationKpis, relativeDay, remaining, signedAmount, urgency, type InstanceLike } from "./lib";

const today = "2026-10-19";

describe("vencimientos", () => {
  it("clasifica cuotas abiertas por fecha", () => {
    expect(dueState("2026-10-18", "pending", today)).toBe("overdue");
    expect(dueState("2026-10-18", "partial", today)).toBe("overdue");
    expect(dueState("2026-10-19", "pending", today)).toBe("today");
    expect(dueState("2026-10-26", "pending", today)).toBe("soon");
    expect(dueState("2026-10-27", "pending", today)).toBe("later");
  });

  it("pagadas, omitidas y anuladas no vencen", () => {
    expect(dueState("2026-01-01", "paid", today)).toBe("paid");
    expect(dueState("2026-01-01", "skipped", today)).toBe("skipped");
    expect(dueState("2026-01-01", "void", today)).toBe("void");
  });

  it("urgencia como en Sublime", () => {
    expect(urgency("2026-10-19", today)).toBe("critical");
    expect(urgency("2026-10-22", today)).toBe("high");
    expect(urgency("2026-10-26", today)).toBe("medium");
    expect(urgency("2026-11-01", today)).toBe("low");
  });

  it("días y fecha relativa", () => {
    expect(daysFrom("2026-10-09", today)).toBe(10);
    expect(relativeDay("2026-10-20", today)).toBe("Mañana");
    expect(relativeDay("2026-10-16", today)).toBe("hace 3 días");
    expect(relativeDay("2026-10-24", today)).toBe("en 5 días");
  });

  it("signo del movimiento", () => {
    expect(signedAmount({ direction: "out", amount: 30 })).toBe(-30);
  });
});

describe("calendario", () => {
  it("octubre 2026 empieza jueves: tres celdas vacías antes", () => {
    const grid = monthGrid("2026-10");
    expect(grid.slice(0, 4)).toEqual([null, null, null, "2026-10-01"]);
    expect(grid.length % 7).toBe(0);
    expect(grid.filter(Boolean)).toHaveLength(31);
  });

  it("febrero y cambio de año", () => {
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
});

describe("indicadores", () => {
  const rows: InstanceLike[] = [
    { due_date: "2026-10-05", amount: 300, paid_amount: 300, currency: "USD", status: "paid" },
    { due_date: "2026-10-10", amount: 100, paid_amount: 40, currency: "USD", status: "partial" },
    { due_date: "2026-10-22", amount: 5000, paid_amount: 0, currency: "VES", status: "pending" },
    { due_date: "2026-10-25", amount: 50, paid_amount: 0, currency: "USD", status: "void" },
    { due_date: "2026-09-30", amount: 80, paid_amount: 0, currency: "USD", status: "pending" },
    { due_date: "2026-11-01", amount: null, paid_amount: 0, currency: "USD", status: "pending" },
  ];

  it("totales del mes por moneda, sin anuladas", () => {
    const k = obligationKpis(rows, "2026-10", today);
    expect(k.due).toEqual({ USD: 400, VES: 5000 });
    expect(k.paid).toEqual({ USD: 340 });
    expect(k.open).toBe(2);
  });

  it("vencidas de cualquier mes y próximas 7 días", () => {
    const k = obligationKpis(rows, "2026-10", today);
    expect(k.overdue).toBe(2);
    expect(k.upcoming).toBe(1);
  });

  it("lo que falta", () => {
    expect(remaining(rows[1])).toBe(60);
    expect(remaining(rows[5])).toBeNull();
  });
});
