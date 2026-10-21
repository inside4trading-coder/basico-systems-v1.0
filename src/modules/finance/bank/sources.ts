/**
 * Fuentes de archivos del centro de conciliación: cada cuenta bancaria con su
 * estado de cuenta y, si está habilitada, la financiadora.
 */

export type SourceStatus = "ok" | "late" | "never";

export const SOURCE_STATUS_LABEL: Record<SourceStatus, string> = {
  ok: "Al día",
  late: "Atrasado",
  never: "Nunca cargado",
};

/** Al día: cargado en los últimos 3 días. */
export const LATE_AFTER_DAYS = 3;

export function sourceStatus(lastLoad: string | null, now: Date = new Date()): SourceStatus {
  if (!lastLoad) return "never";
  const days = (now.getTime() - new Date(lastLoad).getTime()) / 86_400_000;
  return days > LATE_AFTER_DAYS ? "late" : "ok";
}

/** Última carga por cuenta, a partir de las cargas (más recientes primero o no). */
export function lastLoadByAccount(batches: { account_id: string; created_at: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const b of batches) {
    if (!out[b.account_id] || b.created_at > out[b.account_id]) out[b.account_id] = b.created_at;
  }
  return out;
}

export function bankGuide(accountName: string): string[] {
  return [
    `Entra a la banca en línea de ${accountName}`,
    "Ve a Movimientos o Estado de cuenta",
    "Elige el rango de fechas desde la última carga",
    "Descarga el archivo en Excel o CSV",
    "Súbelo aquí con el perfil de la cuenta",
  ];
}

export function financingOrdersGuide(provider: string): string[] {
  return [
    `Entra al portal de comercios de ${provider}`,
    "Movimientos → pestaña Órdenes",
    "Selecciona el rango de fechas y pulsa Buscar",
    "Pulsa Descargar en la esquina inferior derecha de la tabla",
  ];
}

export function financingPaymentsGuide(provider: string): string[] {
  return [
    `Entra al portal de comercios de ${provider}`,
    "Movimientos → pestaña Pagos",
    "Selecciona el mismo rango de fechas que las órdenes y pulsa Buscar",
    "Pulsa Descargar en la esquina inferior derecha de la tabla",
  ];
}
