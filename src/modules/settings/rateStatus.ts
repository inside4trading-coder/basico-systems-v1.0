/** Textos y reglas de la pantalla de la tasa (sin React, para probarlos). */
import { formatRate, formatRateDate } from "@/core/money";
import type { CurrentRate, RateFetchMode, RateStatus } from "./api";

export const CHECK_MODE_LABEL: Record<RateFetchMode, string> = {
  auto: "automática",
  cron: "programada",
  refresh: "a mano",
  test: "prueba de conexión",
};

export const HISTORY_LABEL: Record<RateStatus["history"][number]["source"], string> = {
  bcv: "BCV",
  dolarapi: "BCV vía DolarAPI",
  manual: "Tasa propia",
  override: "Emergencia",
};

export function sourceLabel(source: CurrentRate["source"], overrideActive: boolean): string {
  if (source === "manual") return overrideActive ? "Tasa de emergencia" : "Tasa propia";
  return HISTORY_LABEL[source];
}

/** Aviso para el dueño cuando la tasa no está al día o la consulta falla; null si todo va bien. */
export function rateAlert(status: RateStatus): { title: string; detail: string } | null {
  const current = status.current;
  if (!current) {
    return {
      title: "No hay tasa",
      detail:
        status.rate_source === "bcv"
          ? `La consulta al BCV todavía no trajo ninguna tasa${status.last_error ? ` (${status.last_error.error})` : ""}. Toca «Actualizar tasa ahora» o pon una tasa de emergencia.`
          : "Fija tu tasa propia para poder cobrar en bolívares.",
    };
  }
  // Con tasa propia o de emergencia, la tasa la decide el negocio.
  if (status.rate_source === "manual" || status.override?.active) return null;

  const using = `El POS sigue cobrando con ${formatRate(current.rate)}, que rige desde el ${formatRateDate(current.effective_date)}.`;
  const why = status.failing && status.last_check?.error ? `${status.last_check.error}. ` : "";
  if (current.stale) {
    return { title: "La tasa está vieja", detail: `${why}${using} Toca «Actualizar tasa ahora» o pon una tasa de emergencia.` };
  }
  if (status.failing) {
    return { title: "Falló la última consulta de la tasa", detail: `${why}${using} Se vuelve a intentar sola cada hora.` };
  }
  return null;
}
