/** Periodos del fichaje, como el filtro del ERP. */
import { addDays, caracasToday, type DateRange } from "@/modules/reports/dates";
import { weekdayOf } from "./lib";

export type ClockPeriod = "today" | "yesterday" | "week" | "month" | "last_month" | "3m" | "6m" | "year";

export const CLOCK_PERIOD_LABEL: Record<ClockPeriod, string> = {
  today: "Hoy",
  yesterday: "Ayer",
  week: "Esta semana",
  month: "Mes actual",
  last_month: "Mes pasado",
  "3m": "Últimos 3 meses",
  "6m": "Últimos 6 meses",
  year: "Último año",
};

const monthStart = (day: string) => `${day.slice(0, 7)}-01`;

export function clockPeriodRange(period: ClockPeriod, today: string = caracasToday()): DateRange {
  switch (period) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case "week": {
      // Semana de lunes a hoy.
      const back = (weekdayOf(today) + 6) % 7;
      return { from: addDays(today, -back), to: today };
    }
    case "month":
      return { from: monthStart(today), to: today };
    case "last_month": {
      const end = addDays(monthStart(today), -1);
      return { from: monthStart(end), to: end };
    }
    case "3m":
      return { from: addDays(today, -89), to: today };
    case "6m":
      return { from: addDays(today, -181), to: today };
    case "year":
      return { from: addDays(today, -364), to: today };
  }
}
