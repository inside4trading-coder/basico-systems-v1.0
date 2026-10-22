/**
 * Fichaje: tipos y cuentas de horas, sin acceso a red. Portado de las métricas
 * de SublimeAdminFichaje (basicosystems@f551478b).
 *
 * Las horas de un día salen de recorrer sus marcas en orden: de una entrada (o
 * fin de descanso) a una salida (o inicio de descanso) se trabaja; del inicio
 * al fin del descanso, no. Un día sin salida queda "abierto": cuenta lo
 * trabajado hasta la última marca. Las marcas rechazadas no cuentan.
 */

export type ClockKind = "entrada" | "salida" | "inicio_descanso" | "fin_descanso";
export type ClockStatus = "ok" | "revisar" | "aprobado" | "rechazado";

export interface ClockEvent {
  id: string;
  staff_id: string;
  location_id: string | null;
  kind: ClockKind;
  event_at: string;
  source: "telefono" | "admin";
  distance_m: number | null;
  accuracy_m: number | null;
  late_minutes: number | null;
  status: ClockStatus;
  note: string | null;
}

export const KIND_LABEL: Record<ClockKind, string> = {
  entrada: "Entrada",
  salida: "Salida",
  inicio_descanso: "Inicio de descanso",
  fin_descanso: "Fin de descanso",
};

export const STATUS_LABEL: Record<ClockStatus, string> = {
  ok: "OK",
  revisar: "Por revisar",
  aprobado: "Aprobado",
  rechazado: "Rechazado",
};

export const WEEKDAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"] as const;

const caracasDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Caracas", year: "numeric", month: "2-digit", day: "2-digit" });

/** Día (aaaa-mm-dd) en hora de Caracas. */
export function caracasDay(iso: string): string {
  return caracasDate.format(new Date(iso));
}

export interface DaySummary {
  staffId: string;
  day: string;
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  /** Sin salida: el día no está cerrado. */
  open: boolean;
  /** Marcas por revisar ese día. */
  pending: number;
}

const minutesBetween = (a: string, b: string) => Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 60000);

/** Resumen de un día de una persona a partir de sus marcas. */
export function summarizeDay(staffId: string, day: string, events: ClockEvent[]): DaySummary {
  const marks = events.filter((e) => e.status !== "rechazado").sort((a, b) => a.event_at.localeCompare(b.event_at));
  let workingSince: string | null = null;
  let breakSince: string | null = null;
  let worked = 0;
  let rest = 0;
  let firstIn: string | null = null;
  let lastOut: string | null = null;
  let late = 0;

  for (const m of marks) {
    switch (m.kind) {
      case "entrada":
        firstIn ??= m.event_at;
        late += m.late_minutes ?? 0;
        workingSince = m.event_at;
        break;
      case "inicio_descanso":
        if (workingSince) worked += minutesBetween(workingSince, m.event_at);
        workingSince = null;
        breakSince = m.event_at;
        break;
      case "fin_descanso":
        if (breakSince) rest += minutesBetween(breakSince, m.event_at);
        breakSince = null;
        workingSince = m.event_at;
        break;
      case "salida":
        if (workingSince) worked += minutesBetween(workingSince, m.event_at);
        workingSince = null;
        lastOut = m.event_at;
        break;
    }
  }
  const lastKind = marks.at(-1)?.kind;
  return {
    staffId,
    day,
    firstIn,
    lastOut,
    workedMinutes: Math.round(worked),
    breakMinutes: Math.round(rest),
    lateMinutes: late,
    open: marks.length > 0 && lastKind !== "salida",
    pending: events.filter((e) => e.status === "revisar").length,
  };
}

/** Un resumen por persona y día (hora de Caracas), del más reciente al más viejo. */
export function attendanceDays(events: ClockEvent[]): DaySummary[] {
  const groups = new Map<string, ClockEvent[]>();
  for (const e of events) {
    const key = `${e.staff_id}|${caracasDay(e.event_at)}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      const [staffId, day] = key.split("|");
      return summarizeDay(staffId, day, list);
    })
    .sort((a, b) => b.day.localeCompare(a.day) || a.staffId.localeCompare(b.staffId));
}

export interface StaffTotals {
  staffId: string;
  days: number;
  workedMinutes: number;
  lateDays: number;
  lateMinutes: number;
  openDays: number;
}

/** Totales del periodo por persona. */
export function staffTotals(days: DaySummary[]): StaffTotals[] {
  const by = new Map<string, StaffTotals>();
  for (const d of days) {
    const t = by.get(d.staffId) ?? { staffId: d.staffId, days: 0, workedMinutes: 0, lateDays: 0, lateMinutes: 0, openDays: 0 };
    by.set(d.staffId, {
      ...t,
      days: t.days + (d.firstIn ? 1 : 0),
      workedMinutes: t.workedMinutes + d.workedMinutes,
      lateDays: t.lateDays + (d.lateMinutes > 0 ? 1 : 0),
      lateMinutes: t.lateMinutes + d.lateMinutes,
      openDays: t.openDays + (d.open ? 1 : 0),
    });
  }
  return [...by.values()];
}

/** Dónde está cada persona ahora según su última marca de hoy. */
export type PresenceState = "fuera" | "trabajando" | "descanso" | "salio";

export function presenceOf(todayEvents: ClockEvent[]): PresenceState {
  const last = todayEvents.filter((e) => e.status !== "rechazado").sort((a, b) => a.event_at.localeCompare(b.event_at)).at(-1);
  if (!last) return "fuera";
  if (last.kind === "salida") return "salio";
  if (last.kind === "inicio_descanso") return "descanso";
  return "trabajando";
}

/** 125 → "2 h 05 min". */
export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = Math.round(total % 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}

// ---------------------------------------------------------------------------
// Horario, incidencias y métricas (como SublimeAdminFichaje, basicosystems@9cb08cd)
// ---------------------------------------------------------------------------

export interface StaffSchedule {
  id: string;
  work_days: number[];
  entry_time: string | null;
  exit_time: string | null;
  break_minutes: number;
  late_tolerance: number;
}

const toMinutes = (hhmm: string | null) => {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

const caracasClock = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Caracas", hour: "2-digit", minute: "2-digit", hour12: false });
/** Minutos desde la medianoche de Caracas de un instante. */
export function caracasMinutes(iso: string): number {
  const [h, m] = caracasClock.format(new Date(iso)).split(":").map(Number);
  return (h % 24) * 60 + m;
}

/** Día de la semana (0 = domingo) de un aaaa-mm-dd. */
export function weekdayOf(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Minutos que la persona debía trabajar ese día según su horario (0 si no le toca o no tiene horario). */
export function expectedMinutes(s: StaffSchedule | undefined, day: string): number {
  if (!s || !s.work_days.includes(weekdayOf(day))) return 0;
  const a = toMinutes(s.entry_time);
  const b = toMinutes(s.exit_time);
  if (a === null || b === null || b <= a) return 0;
  return Math.max(0, b - a - s.break_minutes);
}

export type DayStatus = "completa" | "en_turno" | "no_cerro" | "pendiente";

export const DAY_STATUS_LABEL: Record<DayStatus, string> = {
  completa: "Completa",
  en_turno: "En turno",
  no_cerro: "No cerró turno",
  pendiente: "Pendiente revisión",
};

export function dayStatus(d: DaySummary, today: string): DayStatus {
  if (d.pending > 0) return "pendiente";
  if (d.open) return d.day === today ? "en_turno" : "no_cerro";
  return "completa";
}

export type IncidentKind = "retraso" | "salida_anticipada" | "sin_salida" | "fuera_de_radio" | "pendiente";

export const INCIDENT_LABEL: Record<IncidentKind, string> = {
  retraso: "Retraso",
  salida_anticipada: "Salida anticipada",
  sin_salida: "Sin salida marcada",
  fuera_de_radio: "Fuera de radio",
  pendiente: "Pendiente de revisión",
};

export interface Incident {
  kind: IncidentKind;
  staffId: string;
  day: string;
  /** Minutos de retraso o de salida anticipada. */
  minutes: number | null;
  detail: string | null;
}

/** Radio de fichaje de cada sede, para saber si una marca quedó fuera. */
export type RadiusByLocation = Record<string, number | null>;

/** Incidencias de un día de una persona. */
export function dayIncidents(
  d: DaySummary,
  dayEvents: ClockEvent[],
  schedule: StaffSchedule | undefined,
  radius: RadiusByLocation,
  today: string,
): Incident[] {
  const out: Incident[] = [];
  const base = { staffId: d.staffId, day: d.day };
  if (d.lateMinutes > 0) out.push({ ...base, kind: "retraso", minutes: d.lateMinutes, detail: null });
  const exit = toMinutes(schedule?.exit_time ?? null);
  if (!d.open && d.lastOut && exit !== null && expectedMinutes(schedule, d.day) > 0) {
    const early = exit - caracasMinutes(d.lastOut);
    if (early > (schedule?.late_tolerance ?? 0)) out.push({ ...base, kind: "salida_anticipada", minutes: early, detail: null });
  }
  if (d.open && d.day < today) out.push({ ...base, kind: "sin_salida", minutes: null, detail: null });
  for (const e of dayEvents) {
    const r = e.location_id ? radius[e.location_id] : null;
    if (e.status !== "rechazado" && e.distance_m !== null && r && e.distance_m > r) {
      out.push({ ...base, kind: "fuera_de_radio", minutes: null, detail: `${KIND_LABEL[e.kind]} a ${Math.round(e.distance_m)} m (radio ${r} m)` });
    }
  }
  if (d.pending > 0) out.push({ ...base, kind: "pendiente", minutes: null, detail: `${d.pending} ${d.pending === 1 ? "marca" : "marcas"}` });
  return out;
}

export interface StaffMetrics {
  staffId: string;
  shifts: number;
  closedShifts: number;
  workedMinutes: number;
  expectedMinutes: number;
  overtimeMinutes: number;
  lateCount: number;
  lateMinutes: number;
  earlyCount: number;
  openCount: number;
  outOfRange: number;
  pending: number;
  /** Entradas a tiempo sobre entradas, en %; null sin entradas. */
  punctuality: number | null;
}

/** Métricas del periodo por persona. Las horas extra son lo trabajado por encima de lo que debía cada día. */
export function staffMetrics(days: DaySummary[], incidents: Incident[], schedules: StaffSchedule[]): StaffMetrics[] {
  const by = new Map<string, StaffMetrics>();
  const empty = (staffId: string): StaffMetrics => ({
    staffId,
    shifts: 0,
    closedShifts: 0,
    workedMinutes: 0,
    expectedMinutes: 0,
    overtimeMinutes: 0,
    lateCount: 0,
    lateMinutes: 0,
    earlyCount: 0,
    openCount: 0,
    outOfRange: 0,
    pending: 0,
    punctuality: null,
  });
  for (const d of days) {
    const m = by.get(d.staffId) ?? empty(d.staffId);
    const expected = expectedMinutes(schedules.find((s) => s.id === d.staffId), d.day);
    by.set(d.staffId, {
      ...m,
      shifts: m.shifts + (d.firstIn ? 1 : 0),
      closedShifts: m.closedShifts + (d.firstIn && !d.open ? 1 : 0),
      workedMinutes: m.workedMinutes + d.workedMinutes,
      expectedMinutes: m.expectedMinutes + expected,
      overtimeMinutes: m.overtimeMinutes + Math.max(0, d.workedMinutes - expected),
      lateMinutes: m.lateMinutes + d.lateMinutes,
    });
  }
  for (const i of incidents) {
    const m = by.get(i.staffId) ?? empty(i.staffId);
    by.set(i.staffId, {
      ...m,
      lateCount: m.lateCount + (i.kind === "retraso" ? 1 : 0),
      earlyCount: m.earlyCount + (i.kind === "salida_anticipada" ? 1 : 0),
      openCount: m.openCount + (i.kind === "sin_salida" ? 1 : 0),
      outOfRange: m.outOfRange + (i.kind === "fuera_de_radio" ? 1 : 0),
      pending: m.pending + (i.kind === "pendiente" ? 1 : 0),
    });
  }
  return [...by.values()].map((m) => ({
    ...m,
    punctuality: m.shifts > 0 ? Math.round(((m.shifts - m.lateCount) / m.shifts) * 100) : null,
  }));
}
