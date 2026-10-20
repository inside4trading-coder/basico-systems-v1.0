import { describe, expect, it } from "vitest";
import type { SaleReceipt } from "./api";
import { localTotal, receiptHtml } from "./receipt";
import { normalizeScannedCode } from "./useScanner";

const sale: SaleReceipt = {
  id: "s1",
  number: "V-000007",
  status: "completed",
  sold_at: "2026-10-19T14:00:00Z",
  base_currency: "USD",
  local_currency: "VES",
  rate: 40.5,
  prices_include_tax: true,
  subtotal: 20,
  discount_total: 2,
  tax_total: 2.48,
  total: 18,
  igtf_total: 0,
  paid_total: 18,
  change_total: 0,
  customer_name: "Taller <El Rápido>",
  customer_doc: "J-123",
  note: null,
  items: [{ line: 1, description: "Pastillas de freno", sku: "PF-1", qty: 2, unit_price: 10, discount: 2, tax_rate: 16, line_total: 18 }],
  payments: [{ method_name: "Pago móvil", currency: "VES", amount: 729, amount_base: 18, igtf_base: 0, reference: "0042", bank: "Banesco" }],
};

describe("nota de entrega", () => {
  it("usa la tasa guardada en la venta para el equivalente local", () => {
    expect(localTotal(sale)).toBe(729);
    expect(localTotal({ ...sale, rate: null })).toBeNull();
  });

  it("escapa lo que escribió el cajero", () => {
    const html = receiptHtml(sale, { businessName: "Repuestos & Co" }, 58);
    expect(html).toContain("Taller &lt;El Rápido&gt;");
    expect(html).toContain("Repuestos &amp; Co");
    expect(html).not.toContain("<El Rápido>");
  });

  it("ajusta la página al ancho del papel y aclara que no es fiscal", () => {
    expect(receiptHtml(sale, { businessName: "X" }, 58)).toContain("size: 58mm auto");
    expect(receiptHtml(sale, { businessName: "X" }, 80)).toContain("size: 80mm auto");
    expect(receiptHtml(sale, { businessName: "X" }, 80)).toContain("Documento no fiscal");
  });
});

describe("lector de códigos", () => {
  it("corrige el guion de un teclado con otra distribución", () => {
    expect(normalizeScannedCode(" PF'001?A ")).toBe("PF-001-A");
  });
  it("imprime razón social, RIF, dirección de la sede y pie", () => {
    const html = receiptHtml(
      sale,
      { businessName: "Ejemplo", legalName: "Repuestos Ejemplo, C.A.", taxId: "J-1234", address: "Av. Principal", phone: "0251-111", locationName: "Cabudare", locationAddress: "Calle 2", footer: "Gracias" },
      80,
    );
    expect(html).toContain("Repuestos Ejemplo, C.A.<br>RIF J-1234");
    expect(html).toContain("Calle 2 · Tel. 0251-111");
    expect(html).not.toContain("Av. Principal");
    expect(html).toContain("Gracias");
  });
});
