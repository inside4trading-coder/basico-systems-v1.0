import { describe, expect, it } from "vitest";
import { clockPeriodRange } from "./periods";

describe("periodos del fichaje", () => {
  const today = "2026-10-22"; // jueves

  it("esta semana va del lunes a hoy", () => {
    expect(clockPeriodRange("week", today)).toEqual({ from: "2026-10-19", to: "2026-10-22" });
    expect(clockPeriodRange("week", "2026-10-19")).toEqual({ from: "2026-10-19", to: "2026-10-19" });
    expect(clockPeriodRange("week", "2026-10-25")).toEqual({ from: "2026-10-19", to: "2026-10-25" });
  });

  it("mes actual y mes pasado", () => {
    expect(clockPeriodRange("month", today)).toEqual({ from: "2026-10-01", to: "2026-10-22" });
    expect(clockPeriodRange("last_month", today)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(clockPeriodRange("last_month", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("hoy y ayer", () => {
    expect(clockPeriodRange("yesterday", today)).toEqual({ from: "2026-10-21", to: "2026-10-21" });
  });
});
