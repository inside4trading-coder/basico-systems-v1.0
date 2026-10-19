import type { LineStatus } from "./api";

export const LINE_STATUS_LABEL: Record<LineStatus, string> = {
  unmatched: "Sin identificar",
  possible: "Posible coincidencia",
  matched: "Conciliada",
  ignored: "Ignorada",
};
