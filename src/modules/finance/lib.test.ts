import { describe, expect, it } from "vitest";
import { daysFrom, dueState, signedAmount } from "./lib";

describe("vencimientos", () => {
  const today = "2026-10-19";

  it("clasifica cuotas pendientes por fecha", () => {
    expect(dueState("2026-10-18", "pending", today)).toBe("overdue");
    expect(dueState("2026-10-19", "pending", today)).toBe("today");
    expect(dueState("2026-10-26", "pending", today)).toBe("soon");
    expect(dueState("2026-10-27", "pending", today)).toBe("later");
  });

  it("pagadas y omitidas no vencen", () => {
    expect(dueState("2026-01-01", "paid", today)).toBe("paid");
    expect(dueState("2026-01-01", "skipped", today)).toBe("skipped");
  });

  it("días de atraso", () => {
    expect(daysFrom("2026-10-09", today)).toBe(10);
    expect(daysFrom("2026-10-22", today)).toBe(-3);
  });

  it("signo del movimiento", () => {
    expect(signedAmount({ direction: "out", amount: 30 })).toBe(-30);
    expect(signedAmount({ direction: "in", amount: 5 })).toBe(5);
  });
});
