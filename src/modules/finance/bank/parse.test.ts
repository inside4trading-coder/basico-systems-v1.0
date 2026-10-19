import { describe, expect, it } from "vitest";
import { parseBankDate, parseBankNumber, parseBankTable, resolveColumn, type BankProfileSpec } from "./parse";

const base: BankProfileSpec = {
  start_row: 2,
  col_date: "A",
  col_time: null,
  col_reference: "B",
  col_operation: null,
  col_description: "C",
  col_debit: "D",
  col_credit: "E",
  col_amount: null,
  col_balance: "F",
  date_format: "DMY",
  decimal_separator: "comma",
  amount_sign: "positive_in",
};

describe("números", () => {
  it("coma decimal con puntos de miles", () => {
    expect(parseBankNumber("1.250.000,50", "comma")).toBe(1250000.5);
    expect(parseBankNumber("Bs. 296,45", "comma")).toBe(296.45);
  });
  it("detecta punto decimal aunque el perfil diga coma", () => {
    expect(parseBankNumber("129,135.00", "comma")).toBe(129135);
    expect(parseBankNumber("296.45", "comma")).toBe(296.45);
  });
  it("tres decimales ambiguos los decide el perfil", () => {
    expect(parseBankNumber("1.250", "comma")).toBe(1250);
    expect(parseBankNumber("1.250", "dot")).toBe(1.25);
  });
  it("negativos con signo o paréntesis, y celdas numéricas", () => {
    expect(parseBankNumber("-35,00", "comma")).toBe(-35);
    expect(parseBankNumber("(35,00)", "comma")).toBe(-35);
    expect(parseBankNumber(12.5, "comma")).toBe(12.5);
    expect(parseBankNumber("", "comma")).toBeNull();
  });
});

describe("fechas", () => {
  it("día/mes/año, mes/día/año e ISO", () => {
    expect(parseBankDate("05/10/2026", "DMY")).toBe("2026-10-05");
    expect(parseBankDate("10/05/2026", "MDY")).toBe("2026-10-05");
    expect(parseBankDate("2026-10-05 08:30", "DMY")).toBe("2026-10-05");
    expect(parseBankDate("5-10-26", "DMY")).toBe("2026-10-05");
  });
  it("celdas de Excel como fecha", () => {
    expect(parseBankDate(new Date(Date.UTC(2026, 9, 5)), "DMY")).toBe("2026-10-05");
  });
  it("rechaza lo ilegible", () => {
    expect(parseBankDate("32/10/2026", "DMY")).toBeNull();
    expect(parseBankDate("ayer", "DMY")).toBeNull();
  });
});

describe("columnas", () => {
  const header = ["Fecha", "Referencia", "Descripción"];
  it("por letra, número o nombre de cabecera", () => {
    expect(resolveColumn("C", header)).toBe(2);
    expect(resolveColumn("2", header)).toBe(1);
    expect(resolveColumn("descripcion", header)).toBe(2);
    expect(resolveColumn("AA", header)).toBe(26);
    expect(resolveColumn(null, header)).toBeNull();
  });
});

describe("estado de cuenta", () => {
  const table = [
    ["Fecha", "Ref", "Concepto", "Débito", "Crédito", "Saldo"],
    ["01/10/2026", "000123", "Pago móvil recibido", "", "1.500,00", "10.000,00"],
    ["", "", "", "", "", ""],
    ["02/10/2026", "", "Comisión", "15,50", "", "9.984,50"],
    ["xx", "9", "Fila rota", "1", "", ""],
    ["03/10/2026", "7", "Ambigua", "1,00", "2,00", ""],
  ];

  it("lee débito y crédito, salta vacías y numera como Excel", () => {
    const r = parseBankTable(table, base);
    expect(r.rowsRead).toBe(4);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ row: 2, date: "2026-10-01", direction: "in", amount: 1500, reference: "000123", balance: 10000 });
    expect(r.rows[1]).toMatchObject({ row: 4, direction: "out", amount: 15.5, reference: null, description: "Comisión" });
    expect(r.errors.map((e) => e.row)).toEqual([5, 6]);
    expect(r.errors[0].reason).toContain("Fecha");
    expect(r.errors[1].reason).toContain("ambigua");
  });

  it("una sola columna de monto con el signo del perfil", () => {
    const single = [["Fecha", "Monto"], ["01/10/2026", "-20,00"], ["01/10/2026", "30,00"]];
    const spec = { ...base, col_reference: null, col_description: null, col_debit: null, col_credit: null, col_balance: null, col_amount: "B" };
    expect(parseBankTable(single, spec).rows.map((r) => r.direction)).toEqual(["out", "in"]);
    expect(parseBankTable(single, { ...spec, amount_sign: "positive_out" }).rows.map((r) => r.direction)).toEqual(["in", "out"]);
  });

  it("sin cabecera (fila 1 con datos) usa letras", () => {
    const r = parseBankTable([["01/10/2026", "R1", "x", "", "5,00", ""]], { ...base, start_row: 1 });
    expect(r.rows[0]).toMatchObject({ row: 1, amount: 5, direction: "in" });
  });
});
