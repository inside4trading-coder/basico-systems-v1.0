import { describe, expect, it } from "vitest";
import type { StockHealthRow } from "./api";
import { rowAmount, rowsInSegment, SEGMENTS, segmentLabel } from "./stockHealth";

const row = (over: Partial<StockHealthRow>): StockHealthRow => ({
  variant_id: "v",
  name: "Filtro",
  sku: null,
  options: {},
  location_id: "l",
  location_name: "Tienda",
  abc_class: "A",
  sold: 60,
  revenue: 1200,
  daily: 2,
  available: 10,
  cover: 5,
  min_qty: null,
  target_qty: null,
  suggested: 20,
  price: 20,
  cost: 12,
  days_at_zero: null,
  lost_sales: null,
  at_risk: 400,
  immobilized: null,
  segment: "por_romper",
  segments: ["por_romper", "clase_a_en_riesgo"],
  ...over,
});

describe("Salud de inventario", () => {
  it("lista los seis segmentos en orden de urgencia", () => {
    expect(SEGMENTS.map((s) => s.key)).toEqual(["quiebre", "por_romper", "alta_rotacion_poco_stock", "clase_a_en_riesgo", "sobrestock", "sin_rotacion"]);
    expect(segmentLabel("sobrestock")).toBe("Sobrestock");
  });

  it("filtra por cualquiera de los segmentos de la fila", () => {
    const rows = [row({}), row({ variant_id: "w", segment: "sobrestock", segments: ["sobrestock"] })];
    expect(rowsInSegment(rows, "clase_a_en_riesgo")).toHaveLength(1);
    expect(rowsInSegment(rows, "sobrestock")[0].variant_id).toBe("w");
    expect(rowsInSegment(rows, null)).toHaveLength(2);
  });

  it("el monto depende del segmento que se mira", () => {
    const quiebre = row({ segment: "quiebre", segments: ["quiebre", "clase_a_en_riesgo"], available: 0, lost_sales: 150, at_risk: 450 });
    expect(rowAmount(quiebre, null)).toBe(150);
    expect(rowAmount(quiebre, "clase_a_en_riesgo")).toBe(150);
    expect(rowAmount(row({}), "clase_a_en_riesgo")).toBe(400);
    expect(rowAmount(row({ segment: "sobrestock", segments: ["sobrestock"], immobilized: 1200 }), null)).toBe(1200);
  });
});
