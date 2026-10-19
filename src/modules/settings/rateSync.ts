/**
 * Mantiene al día la tasa oficial sin intervención: si falta o tiene más de
 * 3 horas, cualquier pantalla abierta le pide a exchange-rate-sync que
 * consulte el BCV (la función no repite antes de 30 minutos). Así no hace
 * falta cron ni guardar claves de servicio: la tasa se actualiza cuando
 * alguien usa el sistema, que es cuando se necesita.
 */
import { useEffect } from "react";
import { useCurrentRate, useRefreshRate, useTenantSettings } from "./api";

export const RATE_MAX_AGE_MS = 3 * 3600_000;
export const RATE_RETRY_MS = 3600_000;
const CHECK_EVERY_MS = 15 * 60_000;
const LAST_ATTEMPT_KEY = "bsys-rate-sync-last";

export function shouldSyncRate(input: {
  rate: { source: string; fetched_at: string } | null;
  now: number;
  lastAttempt: number | null;
  online: boolean;
}): boolean {
  if (!input.online) return false;
  if (input.lastAttempt !== null && input.now - input.lastAttempt < RATE_RETRY_MS) return false;
  if (!input.rate) return true;
  if (input.rate.source === "manual") return false;
  return input.now - Date.parse(input.rate.fetched_at) > RATE_MAX_AGE_MS;
}

function readLastAttempt(): number | null {
  try {
    const v = Number(localStorage.getItem(LAST_ATTEMPT_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function writeLastAttempt(at: number) {
  try {
    localStorage.setItem(LAST_ATTEMPT_KEY, String(at));
  } catch {
    // Sin almacenamiento: el límite de la función (30 min) sigue protegiendo.
  }
}

export function useRateAutoSync() {
  const { data: settings } = useTenantSettings();
  const { data: rate, isSuccess } = useCurrentRate();
  const refresh = useRefreshRate();
  const needsRate = Boolean(settings?.local_currency) && settings?.rate_source !== "manual";
  const { mutate, isPending } = refresh;

  useEffect(() => {
    if (!needsRate || !isSuccess) return;
    const check = () => {
      const now = Date.now();
      if (isPending || !shouldSyncRate({ rate: rate ?? null, now, lastAttempt: readLastAttempt(), online: navigator.onLine })) return;
      writeLastAttempt(now);
      mutate();
    };
    check();
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [needsRate, isSuccess, rate, mutate, isPending]);
}
