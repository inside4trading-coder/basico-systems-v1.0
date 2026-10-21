/**
 * Segmentos de Salud de inventario (public.report_stock_health): orden,
 * nombre, qué significa cada uno y qué mide su monto.
 */
import type { StockHealthRow, StockSegment } from "./api";

export interface SegmentInfo {
  key: StockSegment;
  label: string;
  /** Qué es, con los días del reporte. */
  describe: (days: number, cover: number) => string;
  /** Qué mide el monto de la tarjeta. */
  amountLabel: string;
  /** Monto a costo (inmovilizado) o a precio (venta en riesgo). */
  atCost: boolean;
}

export const SEGMENTS: SegmentInfo[] = [
  { key: "quiebre", label: "Quiebre", describe: (days) => `Sin disponible y con ventas en ${days} días`, amountLabel: "venta perdida estimada", atCost: false },
  { key: "por_romper", label: "Por romper", describe: () => "Alcanza 7 días o menos, o está en su mínimo", amountLabel: "venta en riesgo", atCost: false },
  { key: "alta_rotacion_poco_stock", label: "Alta rotación, poco stock", describe: (_, cover) => `Lo que más se vende y no alcanza ${cover} días`, amountLabel: "venta en riesgo", atCost: false },
  { key: "clase_a_en_riesgo", label: "Clase A en riesgo", describe: () => "Lo que hace el 80 % de la venta, en quiebre o por romper", amountLabel: "venta en riesgo", atCost: false },
  { key: "sobrestock", label: "Sobrestock", describe: () => "Con ventas y más de 90 días de cobertura", amountLabel: "inmovilizado a costo", atCost: true },
  { key: "sin_rotacion", label: "Sin rotación", describe: (days) => `Con existencia y sin ventas en ${days} días`, amountLabel: "inmovilizado a costo", atCost: true },
];

export const segmentLabel = (key: StockSegment) => SEGMENTS.find((s) => s.key === key)?.label ?? key;

/** Filas del segmento elegido (una fila puede estar en varios); sin filtro, todas. */
export function rowsInSegment(rows: StockHealthRow[], segment: StockSegment | null): StockHealthRow[] {
  return segment ? rows.filter((r) => r.segments.includes(segment)) : rows;
}

/** Monto de la fila según el segmento que se mira (el de la fila si no hay filtro). */
export function rowAmount(row: StockHealthRow, segment: StockSegment | null): number | null {
  const seg = segment ?? row.segment;
  if (seg === "quiebre") return row.lost_sales;
  if (seg === "clase_a_en_riesgo") return row.segments.includes("quiebre") ? row.lost_sales : row.at_risk;
  if (seg === "sobrestock" || seg === "sin_rotacion") return row.immobilized;
  return row.at_risk;
}
