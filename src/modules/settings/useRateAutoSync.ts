/** Monta la sincronización automática de la tasa (ver rateSync.ts). */
import { useEffect } from "react";
import { useCurrentRate, useRefreshRate, useTenantSettings } from "./api";
import { shouldSyncRate } from "./rateSync";

const CHECK_EVERY_MS = 15 * 60_000;
const LAST_ATTEMPT_KEY = "bsys-rate-sync-last";

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
