import { describe, expect, it } from "vitest";
import { couponDiscount, isValidCouponCode, normalizeCouponCode, type AppliedCoupon } from "./coupons";

const pct: AppliedCoupon = { code: "DIEZ", description: null, kind: "percent", value: 10, minPurchase: 15 };
const amt: AppliedCoupon = { code: "CINCO", description: null, kind: "amount", value: 5, minPurchase: 0 };

describe("cupones", () => {
  it("porcentaje sobre la compra", () => {
    expect(couponDiscount(pct, 20)).toBe(2);
    expect(couponDiscount(pct, 33.33)).toBe(3.33);
  });

  it("no aplica bajo la compra mínima", () => {
    expect(couponDiscount(pct, 14.99)).toBe(0);
  });

  it("un monto no pasa de la compra", () => {
    expect(couponDiscount(amt, 20)).toBe(5);
    expect(couponDiscount(amt, 3)).toBe(3);
  });

  it("sin cupón o sin compra, cero", () => {
    expect(couponDiscount(null, 20)).toBe(0);
    expect(couponDiscount(amt, 0)).toBe(0);
  });

  it("el código se normaliza y valida como en el servidor", () => {
    expect(normalizeCouponCode("  diez ")).toBe("DIEZ");
    expect(isValidCouponCode("DIEZ")).toBe(true);
    expect(isValidCouponCode("NAVIDAD-2026")).toBe(true);
    expect(isValidCouponCode("AB")).toBe(false);
    expect(isValidCouponCode("CON ESPACIO")).toBe(false);
  });
});
