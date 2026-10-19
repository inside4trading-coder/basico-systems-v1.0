import { describe, expect, it } from "vitest";
import { parseFinancingTable } from "./financingFile";

describe("archivo de la financiadora", () => {
  const table = [
    ["Reporte de órdenes"],
    [],
    ["# Orden", "# Factura", "Nombre del comprador", "Venta total", "Pago en caja", "Fecha compra", "Monto cuota 1", "Fecha cuota 1", "Estado cuota 1", "Monto cuota 2", "Fecha cuota 2", "Estado cuota 2"],
    ["7777", "V-0001", "Luis", "200,00", "80,00", "19/10/2026", "60,00", "02/11/2026", "done", "60,00", "16/11/2026", "pending"],
    ["", "", "Sin datos", "10", "", "", "", "", "", "", "", ""],
    ["8888", "-", "Marta", 100, 40, new Date(Date.UTC(2026, 9, 18)), 30, "01/11/2026", "", 30, "15/11/2026", "DELAYED"],
  ];

  it("encuentra la cabecera, normaliza columnas y lee cuotas", () => {
    const r = parseFinancingTable(table);
    expect(r.skipped).toBe(1);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({
      external_ref: "7777",
      document: "V-0001",
      customer_name: "Luis",
      sale_total: 200,
      initial_amount: 80,
      issued_on: "2026-10-19",
    });
    expect(r.rows[0].installments).toEqual([
      { number: 1, due_date: "2026-11-02", amount: 60, status: "DONE" },
      { number: 2, due_date: "2026-11-16", amount: 60, status: "PENDING" },
    ]);
    expect(r.rows[1]).toMatchObject({ external_ref: "8888", document: null, issued_on: "2026-10-18" });
    expect(r.rows[1].installments[1].status).toBe("DELAYED");
  });

  it("sin cabecera reconocible avisa", () => {
    expect(() => parseFinancingTable([["a", "b"], ["1", "2"]])).toThrow(/n\.º de orden/);
  });
});
