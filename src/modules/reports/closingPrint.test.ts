import { describe, expect, it } from "vitest";
import type { CashClosure } from "./api";
import { closingHtml } from "./closingPrint";

const closure: CashClosure = {
  session_id: "s1",
  number: "C1-00012",
  status: "closed",
  register_name: "Caja <1>",
  location_name: "Cabudare",
  opened_at: "2026-10-19T12:00:00Z",
  closed_at: "2026-10-19T22:00:00Z",
  opened_by: "cajero@demo.test",
  closed_by: "encargado@demo.test",
  closing_note: null,
  sales_count: 3,
  sales_total: 120.5,
  offline_count: 1,
  counts: [{ currency: "USD", opening: 20, expected: 140.5, counted: 139.5, difference: -1 }],
  by_method: [{ method: "Efectivo USD", currency: "USD", amount: 120.5, amount_base: 120.5 }],
  has_difference: true,
};

describe("impresión del cierre", () => {
  it("lleva esperado, contado, diferencia y firmas", () => {
    const html = closingHtml(closure, "Repuestos Demo", "USD", 80);
    expect(html).toContain("CIERRE DE CAJA");
    expect(html).toContain("$ 139,50");
    expect(html).toContain("$ -1,00");
    expect(html).toContain("Sin conexión");
    expect(html).toContain("Firma encargado");
    expect(html).toContain("size: 80mm auto");
  });

  it("escapa nombres", () => {
    expect(closingHtml(closure, "A & B", "USD", 58)).toContain("Caja &lt;1&gt;");
  });
});
