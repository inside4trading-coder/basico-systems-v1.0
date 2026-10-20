import { describe, expect, it } from "vitest";
import {
  saleItems,
  addToCart,
  cartDiscountAmount,
  cartTotals,
  changeIn,
  igtfOf,
  paymentSummary,
  setLineDiscount,
  setQty,
  suggestedAmount,
  type CartLine,
  type MoneySettings,
  type PaymentMethodLike,
} from "./cart";

const item = (over: Partial<CartLine> = {}): Omit<CartLine, "qty" | "discount"> => ({
  variantId: "v1",
  productId: "p1",
  name: "Filtro de aceite",
  options: {},
  sku: "F-1",
  unit: "unidad",
  price: 10,
  taxRate: 16,
  available: null,
  ...over,
});

const line = (over: Partial<CartLine> = {}): CartLine => ({ ...item(over), qty: 1, discount: 0, ...over });

const money: MoneySettings = { baseCurrency: "USD", localCurrency: "VES", rate: 40, isSpecialTaxpayer: false, igtfRate: 3 };
const usdCash: PaymentMethodLike = { id: "cash_usd", currency: "USD", kind: "cash", applies_igtf: true };
const vesCash: PaymentMethodLike = { id: "cash_ves", currency: "VES", kind: "cash", applies_igtf: false };
const pagoMovil: PaymentMethodLike = { id: "pm", currency: "VES", kind: "mobile_payment", applies_igtf: false };

describe("cartTotals", () => {
  it("extrae el IVA cuando el precio lo incluye", () => {
    const t = cartTotals([line({ price: 11.6 })], 0, true);
    expect(t.total).toBe(11.6);
    expect(t.tax).toBe(1.6);
  });

  it("suma el IVA cuando el precio no lo incluye", () => {
    const t = cartTotals([line({ price: 10, qty: 2 })], 0, false);
    expect(t.subtotal).toBe(20);
    expect(t.tax).toBe(3.2);
    expect(t.total).toBe(23.2);
  });

  it("reparte el descuento del carrito y la última línea se lleva el resto", () => {
    const t = cartTotals(
      [line({ variantId: "a", price: 10, taxRate: 0 }), line({ variantId: "b", price: 10, taxRate: 0 }), line({ variantId: "c", price: 10, taxRate: 0 })],
      1,
      true,
    );
    expect(t.lines.map((l) => l.cartShare)).toEqual([0.33, 0.33, 0.34]);
    expect(t.total).toBe(29);
    expect(t.discount).toBe(1);
  });

  it("aplica el descuento de línea antes que el del carrito", () => {
    const t = cartTotals([line({ variantId: "a", price: 20, discount: 5, taxRate: 0 }), line({ variantId: "b", price: 15, taxRate: 0 })], 3, true);
    expect(t.lineDiscounts).toBe(5);
    expect(t.lines.map((l) => l.cartShare)).toEqual([1.5, 1.5]);
    expect(t.total).toBe(27);
  });

  it("no deja que el descuento del carrito supere el total", () => {
    const t = cartTotals([line({ price: 5, taxRate: 0 })], 50, true);
    expect(t.cartDiscount).toBe(5);
    expect(t.total).toBe(0);
  });

  it("vende cantidades fraccionarias", () => {
    const t = cartTotals([line({ price: 3.33, qty: 1.5, taxRate: 0 })], 0, true);
    expect(t.subtotal).toBe(5);
  });
});

describe("cantidades del carrito", () => {
  it("suma al tocar dos veces el mismo producto", () => {
    const once = addToCart([], item());
    expect(addToCart(once, item())[0].qty).toBe(2);
  });

  it("no pasa del disponible de la sede", () => {
    const lines = addToCart([], item({ available: 2 }), 5);
    expect(lines[0].qty).toBe(2);
    expect(addToCart([], item({ available: 0 }))).toEqual([]);
  });

  it("cantidad cero quita la línea", () => {
    expect(setQty([line()], "v1", 0)).toEqual([]);
  });

  it("al bajar la cantidad recorta el descuento de línea", () => {
    const lines = setQty([line({ qty: 3, discount: 25 })], "v1", 1);
    expect(lines[0].discount).toBe(10);
  });

  it("el descuento de línea no supera el bruto ni es negativo", () => {
    expect(setLineDiscount([line()], "v1", 99)[0].discount).toBe(10);
    expect(setLineDiscount([line()], "v1", -3)[0].discount).toBe(0);
  });

  it("descuento por porcentaje del carrito", () => {
    expect(cartDiscountAmount("percent", 10, 45.5)).toBe(4.55);
    expect(cartDiscountAmount("percent", 150, 20)).toBe(20);
    expect(cartDiscountAmount("amount", 30, 20)).toBe(20);
    expect(cartDiscountAmount("amount", -1, 20)).toBe(0);
  });
});

describe("cobro", () => {
  it("convierte pagos en bolívares con la tasa", () => {
    const s = paymentSummary([{ key: "1", methodId: "pm", amount: 400 }], [pagoMovil], 10, money);
    expect(s.applied).toBe(10);
    expect(s.missing).toBe(0);
  });

  it("calcula lo que falta en un pago mixto", () => {
    const s = paymentSummary(
      [
        { key: "1", methodId: "cash_usd", amount: 5 },
        { key: "2", methodId: "pm", amount: 100 },
      ],
      [usdCash, pagoMovil],
      10,
      money,
    );
    expect(s.paid).toBe(7.5);
    expect(s.missing).toBe(2.5);
    expect(s.hasCash).toBe(true);
  });

  it("marca el excedente como vuelto", () => {
    const s = paymentSummary([{ key: "1", methodId: "cash_usd", amount: 20 }], [usdCash], 12.5, money);
    expect(s.excess).toBe(7.5);
    expect(changeIn(s.excess, "VES", money)).toBe(300);
  });

  it("tolera un centavo por pago, igual que el servidor", () => {
    const s = paymentSummary([{ key: "1", methodId: "pm", amount: 399.6 }], [pagoMovil], 10, money);
    expect(s.applied).toBe(9.99);
    expect(s.missing).toBe(0);
  });

  it("descuenta el IGTF solo a contribuyentes especiales en métodos marcados", () => {
    const special = { ...money, isSpecialTaxpayer: true };
    expect(igtfOf(10.3, usdCash, money)).toBe(0);
    expect(igtfOf(10.3, usdCash, special)).toBe(0.3);
    expect(igtfOf(400, vesCash, special)).toBe(0);
    const s = paymentSummary([{ key: "1", methodId: "cash_usd", amount: 10 }], [usdCash], 10, special);
    expect(s.igtf).toBe(0.29);
    expect(s.missing).toBe(0.29);
  });

  it("sugiere el monto con IGTF para que lo aplicado alcance", () => {
    const special = { ...money, isSpecialTaxpayer: true };
    const amount = suggestedAmount(10, usdCash, special);
    expect(amount).toBe(10.3);
    expect(paymentSummary([{ key: "1", methodId: "cash_usd", amount }], [usdCash], 10, special).missing).toBe(0);
  });

  it("sugiere el faltante en bolívares sin quedar corto por redondeo", () => {
    const odd = { ...money, rate: 36.123 };
    const amount = suggestedAmount(7.77, pagoMovil, odd);
    expect(Math.round((amount / 36.123) * 100) / 100).toBeGreaterThanOrEqual(7.77);
  });

  it("sin tasa, un pago en bolívares no se puede convertir", () => {
    const s = paymentSummary([{ key: "1", methodId: "pm", amount: 100 }], [pagoMovil], 10, { ...money, rate: null });
    expect(s.unconvertible).toBe(true);
    expect(suggestedAmount(5, pagoMovil, { ...money, rate: null })).toBe(0);
  });
});

describe("líneas para register_sale", () => {
  it("catálogo manda la variante; concepto manual, descripción, precio e impuesto", () => {
    const base = { productId: "p", options: {}, sku: null, unit: "unidad", taxRate: 16, qty: 2, discount: 1, available: null };
    expect(
      saleItems([
        { ...base, variantId: "v1", name: "Filtro", price: 10 },
        { ...base, variantId: "manual-1", productId: "", name: "Mano de obra", price: 15, manual: { kind: "servicio", taxRateId: "t0" } },
      ]),
    ).toEqual([
      { variant_id: "v1", qty: 2, discount: 1 },
      { manual: true, kind: "servicio", description: "Mano de obra", price: 15, qty: 2, discount: 1, tax_rate_id: "t0" },
    ]);
  });
});
