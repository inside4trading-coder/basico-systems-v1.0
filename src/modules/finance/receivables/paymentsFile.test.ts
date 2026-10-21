import { describe, expect, it } from "vitest";
import { ORDERS_FILE_MESSAGE, parseFinancingPayments } from "./paymentsFile";

const header = ["Fecha de transacción", "Método de pago", "Monto pagado en VES", "Monto pagado en USD", "Tasa de cambio", "Referencia", "Cuota", "Orden", "Factura"];

describe("archivo de pagos de la financiadora", () => {
  it("lee cada pago con monto en Bs, divisa, referencia, cuota, orden y factura", () => {
    const rows = parseFinancingPayments([
      ["Reporte de pagos"],
      header,
      ["16/10/2026", "Pago móvil", "3.000,50", "30,01", "100", "927842011", "1", "9001", "V-000100"],
      ["17/10/2026", "Transferencia", 6000, 60, 100, 555111, 2, 9002, ""],
      ["", "", "", "", "", "", "", "", ""],
    ]);
    expect(rows).toEqual([
      { row: 3, date: "2026-10-16", amount_local: 3000.5, amount_base: 30.01, reference: "927842011", installment: "1", order: "9001", invoice: "V-000100" },
      { row: 4, date: "2026-10-17", amount_local: 6000, amount_base: 60, reference: "555111", installment: "2", order: "9002", invoice: "" },
    ]);
  });

  it("reconoce el reporte de órdenes y avisa que va en el paso 1", () => {
    expect(() => parseFinancingPayments([["Orden", "Monto cuota 1", "Fecha cuota 1"]])).toThrow(ORDERS_FILE_MESSAGE);
  });

  it("pide las columnas que faltan", () => {
    expect(() => parseFinancingPayments([["Fecha", "Monto pagado en VES"]])).toThrow(/Referencia, Cuota, Orden/);
  });
});
