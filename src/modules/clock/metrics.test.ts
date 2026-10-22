import { describe, expect, it } from "vitest";
import { dayIncidents, dayStatus, expectedMinutes, staffMetrics, summarizeDay, type ClockEvent, type StaffSchedule } from "./lib";

const ana: StaffSchedule = { id: "ana", work_days: [1, 2, 3, 4, 5], entry_time: "08:00:00", exit_time: "17:00:00", break_minutes: 60, late_tolerance: 10 };

const ev = (kind: ClockEvent["kind"], day: string, hhmm: string, extra: Partial<ClockEvent> = {}): ClockEvent => ({
  id: `${kind}-${day}-${hhmm}`,
  staff_id: "ana",
  location_id: "t1",
  kind,
  event_at: new Date(`${day}T${hhmm}:00-04:00`).toISOString(),
  source: "telefono",
  distance_m: 20,
  accuracy_m: 10,
  late_minutes: null,
  status: "ok",
  note: null,
  ...extra,
});

describe("métricas de fichaje", () => {
  it("lo que debía trabajar según su horario", () => {
    expect(expectedMinutes(ana, "2026-10-20")).toBe(480); // martes: 9 h menos 1 h de descanso
    expect(expectedMinutes(ana, "2026-10-18")).toBe(0); // domingo no le toca
    expect(expectedMinutes(undefined, "2026-10-20")).toBe(0);
  });

  it("estado del día", () => {
    const open = summarizeDay("ana", "2026-10-20", [ev("entrada", "2026-10-20", "08:00")]);
    expect(dayStatus(open, "2026-10-20")).toBe("en_turno");
    expect(dayStatus(open, "2026-10-21")).toBe("no_cerro");
    const pending = summarizeDay("ana", "2026-10-20", [ev("entrada", "2026-10-20", "08:00", { status: "revisar" }), ev("salida", "2026-10-20", "17:00")]);
    expect(dayStatus(pending, "2026-10-21")).toBe("pendiente");
  });

  it("incidencias: retraso, salida anticipada, fuera de radio", () => {
    const events = [ev("entrada", "2026-10-20", "08:25", { late_minutes: 15 }), ev("salida", "2026-10-20", "16:30", { distance_m: 400 })];
    const d = summarizeDay("ana", "2026-10-20", events);
    const kinds = dayIncidents(d, events, ana, { t1: 100 }, "2026-10-21").map((i) => `${i.kind}:${i.minutes ?? ""}`);
    expect(kinds).toEqual(["retraso:15", "salida_anticipada:30", "fuera_de_radio:"]);
  });

  it("salir dentro de la tolerancia no es salida anticipada", () => {
    const events = [ev("entrada", "2026-10-20", "08:00"), ev("salida", "2026-10-20", "16:55")];
    const d = summarizeDay("ana", "2026-10-20", events);
    expect(dayIncidents(d, events, ana, {}, "2026-10-21")).toEqual([]);
  });

  it("horas extra y puntualidad", () => {
    const tue = [ev("entrada", "2026-10-20", "08:00"), ev("inicio_descanso", "2026-10-20", "12:00"), ev("fin_descanso", "2026-10-20", "13:00"), ev("salida", "2026-10-20", "18:00")];
    const wed = [ev("entrada", "2026-10-21", "08:30", { late_minutes: 20 }), ev("salida", "2026-10-21", "17:00")];
    const d1 = summarizeDay("ana", "2026-10-20", tue);
    const d2 = summarizeDay("ana", "2026-10-21", wed);
    const incidents = [...dayIncidents(d1, tue, ana, {}, "2026-10-22"), ...dayIncidents(d2, wed, ana, {}, "2026-10-22")];
    const [m] = staffMetrics([d1, d2], incidents, [ana]);
    expect(m.workedMinutes).toBe(540 + 510);
    expect(m.expectedMinutes).toBe(960);
    expect(m.overtimeMinutes).toBe(90);
    expect(m.lateCount).toBe(1);
    expect(m.punctuality).toBe(50);
    expect(m.closedShifts).toBe(2);
  });
});
