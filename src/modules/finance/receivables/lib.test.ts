import { describe, expect, it } from "vitest";
import { installmentLeft, installmentState, nextDue, splitInstallments } from "./lib";

const today = "2026-10-19";
const inst = (due_date: string, amount: number, collected = 0, covered = 0) => ({ due_date, amount, collected, covered });

describe("cuotas por cobrar", () => {
  it("estados", () => {
    expect(installmentState(inst("2026-10-01", 30, 30), today)).toBe("paid");
    expect(installmentState(inst("2026-10-01", 30, 0, 30), today)).toBe("covered");
    expect(installmentState(inst("2026-10-01", 30, 10), today)).toBe("overdue");
    expect(installmentState(inst("2026-10-30", 30, 10), today)).toBe("partial");
    expect(installmentState(inst("2026-10-30", 30), today)).toBe("pending");
  });

  it("lo que falta y la próxima abierta", () => {
    expect(installmentLeft(inst("2026-10-30", 30, 12.5, 2))).toBe(15.5);
    const list = [inst("2026-12-01", 10), inst("2026-11-01", 10, 10), inst("2026-11-15", 10, 3)];
    expect(nextDue(list)?.due_date).toBe("2026-11-15");
  });

  it("reparte en cuotas iguales y la última absorbe el redondeo", () => {
    const parts = splitInstallments(100, 3, "2026-11-01", 15);
    expect(parts.map((p) => p.amount)).toEqual([33.33, 33.33, 33.34]);
    expect(parts.map((p) => p.due_date)).toEqual(["2026-11-01", "2026-11-16", "2026-12-01"]);
  });
});
