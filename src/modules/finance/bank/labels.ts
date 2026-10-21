import type { LineStatus } from "./api";

export const LINE_STATUS_LABEL: Record<LineStatus, string> = {
  unmatched: "Sin identificar",
  possible: "Posible coincidencia",
  matched: "Conciliada",
  ignored: "Ignorada",
};

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Resumen de una conciliación automática. */
export const importOutcome = (r: { auto_matched: number; possible: number; unmatched: number }) =>
  `${count(r.auto_matched, "conciliada sola", "conciliadas solas")} · ${count(r.possible, "posible", "posibles")} · ${r.unmatched} sin identificar`;
