/**
 * Cupones en el carrito. El cálculo es el mismo que hace el servidor
 * (app.coupon_amount): porcentaje sobre la compra después de los descuentos
 * por línea, o un monto que no pasa de la compra.
 */
import { round2 } from "./cart";

export interface AppliedCoupon {
  code: string;
  description: string | null;
  kind: "percent" | "amount";
  value: number;
  minPurchase: number;
}

export function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase();
}

export function isValidCouponCode(code: string): boolean {
  return /^[A-Z0-9][A-Z0-9_-]{2,23}$/.test(code);
}

/** Descuento del cupón para una compra; 0 si no alcanza la compra mínima. */
export function couponDiscount(coupon: AppliedCoupon | null | undefined, base: number): number {
  if (!coupon || base <= 0 || base < coupon.minPurchase) return 0;
  if (coupon.kind === "percent") return round2((base * coupon.value) / 100);
  return Math.min(round2(coupon.value), round2(base));
}

export function couponLabel(coupon: AppliedCoupon, format: (n: number) => string): string {
  return coupon.kind === "percent" ? `${coupon.code} · ${coupon.value.toLocaleString("es-VE")} %` : `${coupon.code} · ${format(coupon.value)}`;
}
