import { describe, expect, it } from "vitest";
import { closingReminderDue, elapsedSince, isStaleSession } from "./sessionRules";

describe("avisos de caja", () => {
  it("caja de ayer en Caracas aunque en UTC sea el mismo día", () => {
    // 20-oct 01:00 UTC = 19-oct 21:00 Caracas.
    expect(isStaleSession("2026-10-20T01:00:00Z", new Date("2026-10-20T13:00:00Z"))).toBe(true);
    expect(isStaleSession("2026-10-20T12:00:00Z", new Date("2026-10-20T23:00:00Z"))).toBe(false);
  });

  it("recordatorio desde la hora configurada, en hora de Caracas", () => {
    const at1730 = new Date("2026-10-20T21:30:00Z"); // 17:30 Caracas
    expect(closingReminderDue("17:30:00", at1730)).toBe(true);
    expect(closingReminderDue("18:00", at1730)).toBe(false);
    expect(closingReminderDue(null, at1730)).toBe(false);
  });

  it("tiempo abierta", () => {
    const now = new Date("2026-10-20T12:00:00Z");
    expect(elapsedSince("2026-10-20T11:48:00Z", now)).toBe("12 min");
    expect(elapsedSince("2026-10-20T06:50:00Z", now)).toBe("5 h 10 min");
    expect(elapsedSince("2026-10-18T09:00:00Z", now)).toBe("2 d 3 h");
  });
});
