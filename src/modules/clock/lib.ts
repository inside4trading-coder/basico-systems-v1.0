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
