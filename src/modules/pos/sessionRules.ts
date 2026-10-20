/**
 * Avisos de la caja. Portado de PosStaleSessionAlert y PosClosingReminder
 * (basicosystems@f551478b). Todo en hora de Caracas.
 */

const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Caracas", year: "numeric", month: "2-digit", day: "2-digit" });
const TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Caracas", hour: "2-digit", minute: "2-digit", hour12: false });

/** La sesión se abrió un día anterior (Caracas) y sigue abierta. */
export function isStaleSession(openedAt: string, now: Date = new Date()): boolean {
  return DAY.format(new Date(openedAt)) < DAY.format(now);
}

/** Ya pasó la hora del recordatorio de cierre ("HH:MM" o "HH:MM:SS"); null = sin recordatorio. */
export function closingReminderDue(reminder: string | null | undefined, now: Date = new Date()): boolean {
  if (!reminder) return false;
  return TIME.format(now) >= reminder.slice(0, 5);
}

/** "2 d 3 h", "5 h 10 min" o "12 min". */
export function elapsedSince(iso: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60000));
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}
