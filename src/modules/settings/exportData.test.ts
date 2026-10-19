import { describe, expect, it } from "vitest";
import { EXPORT_SHEETS, exportFileName, toTable } from "./exportData";

describe("exportar datos", () => {
  it("une columnas, omite tenant_id y convierte valores", () => {
    const t = toTable([
      { id: "a", tenant_id: "x", amount: "12.50", active: true, raw: { b: 1 } },
      { id: "b", tenant_id: "x", note: "hola", amount: null },
    ]);
    expect(t.headers).toEqual(["id", "amount", "active", "raw", "note"]);
    expect(t.rows[0]).toEqual(["a", 12.5, true, '{"b":1}', null]);
    expect(t.rows[1]).toEqual(["b", null, null, null, "hola"]);
  });

  it("no convierte a número códigos largos ni con ceros que importan", () => {
    const t = toTable([{ code: "0001234567890123456", sku: "FIL-90915" }]);
    expect(t.rows[0]).toEqual(["0001234567890123456", "FIL-90915"]);
  });

  it("nombres de hoja únicos y de 31 caracteres o menos (límite de Excel)", () => {
    const names = EXPORT_SHEETS.map((s) => s.sheet);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((n) => n.length <= 31)).toBe(true);
  });

  it("nombre de archivo limpio", () => {
    expect(exportFileName("Repuestos Toyocabudare, C.A.", "2026-10-19")).toBe("repuestos-toyocabudare-c-a-datos-2026-10-19.xlsx");
  });
});
