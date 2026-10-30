import { describe, expect, it } from "vitest";
import { originLabel, partnerCode, productOrigin, stockStatus } from "./lib";

const locations = [
  { id: "t", name: "Tienda", type: "store" as const },
  { id: "a", name: "Aliado X", type: "external" as const },
  { id: "b", name: "Aliado Y", type: "external" as const },
];

describe("partnerCode", () => {
  it("arma el código con el nombre sin acentos ni espacios", () => {
    expect(partnerCode("Repuestos Peña", [])).toBe("REPUESTOSPEN");
  });
  it("no repite un código que ya existe", () => {
    expect(partnerCode("Aliado", ["ALIADO"])).toBe("ALIADO-2");
    expect(partnerCode("Aliado", ["ALIADO", "aliado-2"])).toBe("ALIADO-3");
  });
  it("usa ALIADO si el nombre no tiene letras ni números", () => {
    expect(partnerCode("—", [])).toBe("ALIADO");
  });
});

describe("productOrigin", () => {
  it("es propio si solo hay existencia en sedes propias o en ninguna", () => {
    expect(productOrigin([{ location_id: "t", on_hand: 2 }], locations)).toEqual({ kind: "own" });
    expect(productOrigin([{ location_id: "a", on_hand: 0 }], locations)).toEqual({ kind: "own" });
  });
  it("es del aliado si solo el aliado tiene existencia", () => {
    const o = productOrigin([{ location_id: "t", on_hand: 0 }, { location_id: "a", on_hand: 3 }], locations);
    expect(originLabel(o)).toBe("Del aliado Aliado X");
  });
  it("es ambos si hay propia y de aliados", () => {
    const o = productOrigin(
      [
        { location_id: "t", on_hand: 1 },
        { location_id: "b", on_hand: 1 },
        { location_id: "a", on_hand: 1 },
      ],
      locations,
    );
    expect(originLabel(o)).toBe("Propio y en Aliado X, Aliado Y");
  });
});

describe("stockStatus", () => {
  it("con existencia propia y sin pendientes, se puede vender", () => {
    expect(stockStatus([], { kind: "own" })).toEqual({ kind: "ready", alsoAt: [] });
  });
  it("si solo lo tiene el aliado, se vende por encargo", () => {
    expect(stockStatus([], { kind: "partner", names: ["Aliado X"] })).toEqual({ kind: "encargo", partners: ["Aliado X"] });
  });
  it("si hay propio y del aliado, se vende lo propio y avisa dónde más hay", () => {
    expect(stockStatus([], { kind: "both", names: ["Aliado X"] })).toEqual({ kind: "ready", alsoAt: ["Aliado X"] });
  });
  it("los pendientes mandan sobre el origen", () => {
    expect(stockStatus(["no_price"], { kind: "partner", names: ["Aliado X"] })).toEqual({ kind: "blocked", reasons: ["no_price"] });
  });
});
