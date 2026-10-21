import { describe, expect, it } from "vitest";
import { attendanceDays, caracasDay, formatMinutes, presenceOf, staffTotals, summarizeDay, type ClockEvent } from "./lib";

let n = 0;
function ev(kind: ClockEvent["kind"], at: string, extra: Partial<ClockEvent> = {}): ClockEvent {
  n += 1;
  return { id: `e${n}`, staff_id: "ana", location_id: null, kind, event_at: at, source: "telefono", distance_m: null, accuracy_m: null, late_minutes: null, status: "ok", note: null, ...extra };
}

// 12:00Z = 08:00 en Caracas (UTC−4).
const day = [
  ev("entrada", "2026-10-20T12:12:00Z", { late_minutes: 12 }),
  ev("inicio_descanso", "2026-10-20T16:00:00Z"),
  ev("fin_descanso", "2026-10-20T17:00:00Z"),
  ev("salida", "2026-10-20T21:30:00Z"),
];

describe("horas de un día", () => {
  it("cuenta lo trabajado sin el descanso", () => {
    const s = summarizeDay("ana", "2026-10-20", day);
    expect(s.workedMinutes).toBe(228 + 270);
    expect(s.breakMinutes).toBe(60);
    expect(s.lateMinutes).toBe(12);
    expect(s.open).toBe(false);
    expect(s.firstIn).toBe("2026-10-20T12:12:00Z");
    expect(s.lastOut).toBe("2026-10-20T21:30:00Z");
  });

  it("sin salida el día queda abierto y cuenta hasta la última marca", () => {
    const s = summarizeDay("ana", "2026-10-20", day.slice(0, 2));
    expect(s.open).toBe(true);
    expect(s.workedMinutes).toBe(228);
  });

  it("las marcas rechazadas no cuentan; las por revisar sí, pero se avisan", () => {
    const s = summarizeDay("ana", "2026-10-20", [
      ev("entrada", "2026-10-20T12:00:00Z", { status: "revisar" }),
      ev("salida", "2026-10-20T13:00:00Z", { status: "rechazado" }),
      ev("salida", "2026-10-20T14:00:00Z"),
    ]);
    expect(s.workedMinutes).toBe(120);
    expect(s.pending).toBe(1);
  });
});

describe("días y totales", () => {
  it("agrupa por día de Caracas, no de UTC", () => {
    expect(caracasDay("2026-10-21T02:00:00Z")).toBe("2026-10-20");
    const days = attendanceDays([...day, ev("entrada", "2026-10-21T12:00:00Z"), ev("salida", "2026-10-21T20:00:00Z")]);
    expect(days.map((d) => d.day)).toEqual(["2026-10-21", "2026-10-20"]);
  });

  it("suma horas, días con atraso y días sin cerrar por persona", () => {
    const totals = staffTotals(attendanceDays([...day, ev("entrada", "2026-10-21T12:00:00Z")]));
    expect(totals).toEqual([{ staffId: "ana", days: 2, workedMinutes: 498, lateDays: 1, lateMinutes: 12, openDays: 1 }]);
  });
});

describe("presencia y formato", () => {
  it("dice dónde está según la última marca", () => {
    expect(presenceOf([])).toBe("fuera");
    expect(presenceOf(day.slice(0, 1))).toBe("trabajando");
    expect(presenceOf(day.slice(0, 2))).toBe("descanso");
    expect(presenceOf(day)).toBe("salio");
  });

  it("formatea minutos", () => {
    expect(formatMinutes(498)).toBe("8 h 18 min");
    expect(formatMinutes(45)).toBe("45 min");
  });
});
