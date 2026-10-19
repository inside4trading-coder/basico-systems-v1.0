import { describe, expect, it } from "vitest";
import { addDays, caracasToday, change, presetRange, rangeDays } from "./dates";

describe("rangos de reportes", () => {
  it("hoy es el día de Caracas, no el de UTC", () => {
    // 02:00 UTC del 20 son las 22:00 del 19 en Caracas.
    expect(caracasToday(new Date("2026-10-20T02:00:00Z"))).toBe("2026-10-19");
  });

  it("presets", () => {
    const t = "2026-10-19";
    expect(presetRange("today", t)).toEqual({ from: t, to: t });
    expect(presetRange("yesterday", t)).toEqual({ from: "2026-10-18", to: "2026-10-18" });
    expect(presetRange("7d", t)).toEqual({ from: "2026-10-13", to: t });
    expect(presetRange("month", t)).toEqual({ from: "2026-10-01", to: t });
    expect(presetRange("last_month", t)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(presetRange("last_month", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("días del rango y suma de días", () => {
    expect(rangeDays({ from: "2026-10-13", to: "2026-10-19" })).toBe(7);
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("variación contra el periodo anterior", () => {
    expect(change(120, 100)).toBeCloseTo(0.2);
    expect(change(5, 0)).toBeNull();
  });
});
