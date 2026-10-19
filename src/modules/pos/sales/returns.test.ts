import { describe, expect, it } from "vitest";
import { refundInCurrency, returnAmount, returnTotal, returnableQty } from "./returns";

const line = { id: "a", qty: 3, line_total: 25, returned: 1 };

describe("devoluciones", () => {
  it("lo que queda por devolver", () => {
    expect(returnableQty(line)).toBe(2);
    expect(returnableQty({ ...line, returned: 3 })).toBe(0);
  });

  it("monto proporcional con impuestos", () => {
    expect(returnAmount(line, 1)).toBe(8.33);
    expect(returnAmount(line, 0)).toBe(0);
  });

  it("total sin pasar de lo que queda", () => {
    expect(returnTotal([line, { id: "b", qty: 1, line_total: 10, returned: 0 }], { a: 5, b: 1 })).toBe(26.67);
  });

  it("reintegro en la moneda del método", () => {
    expect(refundInCurrency(10, "USD", "USD", null)).toBe(10);
    expect(refundInCurrency(10, "VES", "USD", 881.07)).toBe(8810.7);
    expect(refundInCurrency(10, "VES", "USD", null)).toBeNull();
  });
});
