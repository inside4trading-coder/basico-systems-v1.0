/**
 * Rangos de fechas de los reportes, en días de Caracas (como el servidor).
 */

export interface DateRange {
  from: string;
  to: string;
}

export type RangePreset = "today" | "yesterday" | "7d" | "30d" | "month" | "last_month";

export const PRESET_LABEL: Record<RangePreset, string> = {
  today: "Hoy",
  yesterday: "Ayer",
  "7d": "7 días",
  "30d": "30 días",
  month: "Este mes",
  last_month: "Mes pasado",
};

/** Fecha de hoy en Caracas como YYYY-MM-DD. */
export function caracasToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Caracas", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function parse(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fmt(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  const d = parse(day);
  d.setUTCDate(d.getUTCDate() + days);
  return fmt(d);
}

export function presetRange(preset: RangePreset, today: string = caracasToday()): DateRange {
  const t = parse(today);
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "month":
      return { from: fmt(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1))), to: today };
    case "last_month": {
      const first = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1));
      const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0));
      return { from: fmt(first), to: fmt(last) };
    }
  }
}

export function rangeDays(range: DateRange): number {
  return Math.round((parse(range.to).getTime() - parse(range.from).getTime()) / 86_400_000) + 1;
}

/** "19 oct" o "19 oct – 25 oct". */
export function rangeLabel(range: DateRange): string {
  const f = (day: string) => parse(day).toLocaleDateString("es-VE", { day: "numeric", month: "short", timeZone: "UTC" });
  return range.from === range.to ? f(range.from) : `${f(range.from)} – ${f(range.to)}`;
}

/** Variación contra el periodo anterior; null si antes no hubo nada. */
export function change(current: number, previous: number): number | null {
  if (!previous) return null;
  return (current - previous) / Math.abs(previous);
}

export function pct(v: number): string {
  return `${(v * 100).toLocaleString("es-VE", { maximumFractionDigits: 1 })} %`;
}
