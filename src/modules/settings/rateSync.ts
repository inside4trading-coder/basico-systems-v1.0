/**
 * Mantiene al día la tasa oficial sin intervención: si falta o tiene más de
 * 3 horas, cualquier pantalla abierta le pide a exchange-rate-sync que
 * consulte el BCV (la función no repite antes de 30 minutos). Es el respaldo
 * de la consulta programada (pg_cron, cada hora). Con tasa de emergencia
 * también consulta: la emergencia vence cuando llega una oficial nueva. Con
 * tasa propia no se llama (useRateAutoSync).
 */
export const RATE_MAX_AGE_MS = 3 * 3600_000;
export const RATE_RETRY_MS = 3600_000;

export function shouldSyncRate(input: {
  rate: { source: string; fetched_at: string } | null;
  now: number;
  lastAttempt: number | null;
  online: boolean;
}): boolean {
  if (!input.online) return false;
  if (input.lastAttempt !== null && input.now - input.lastAttempt < RATE_RETRY_MS) return false;
  if (!input.rate) return true;
  return input.now - Date.parse(input.rate.fetched_at) > RATE_MAX_AGE_MS;
}
