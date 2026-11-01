import { describe, expect, it } from "vitest";
import { withTax } from "@/core/tax";
import {
  DEFAULT_POLICY,
  maxDiscountNoLoss,
  netFromPvp,
  priceStatus,
  profitAt,
  roundPvp,
  suggestPrice,
  type PricingPolicy,
} from "./pricing";

const policy: PricingPolicy = {
  target_margin: 50,
  overhead_pct: 0,
  min_margin: 15,
  rounding: "none",
  concepts: [
    { name: "Vendedor", pct: 3, active: true },
    { name: "Punto de venta", pct: 2, active: true },
    { name: "Apagado", pct: 40, active: false },
  ],
};

describe("roundPvp", () => {
  it("termina en ,99 sin bajar el precio", () => {
    expect(roundPvp(35.2, "99")).toBe(35.99);
    expect(roundPvp(35.99, "99")).toBe(35.99);
    expect(roundPvp(36, "99")).toBe(36.99);
  });
  it("termina en ,90 o en entero", () => {
    expect(roundPvp(35.2, "90")).toBe(35.9);
    expect(roundPvp(35.95, "90")).toBe(36.9);
    expect(roundPvp(35.01, "int")).toBe(36);
    expect(roundPvp(35, "int")).toBe(35);
  });
  it("sin redondeo deja los centavos", () => {
    expect(roundPvp(18.324, "none")).toBe(18.32);
    expect(roundPvp(0, "99")).toBe(0);
  });
});

describe("netFromPvp", () => {
  it("el precio sin IVA da exacto el PVP", () => {
    for (const pvp of [18.99, 9.99, 35.99, 100, 0.99]) {
      expect(withTax(netFromPvp(pvp, 16), 16)).toBe(pvp);
    }
    expect(netFromPvp(12.5, 0)).toBe(12.5);
  });
});

describe("suggestPrice", () => {
  it("costo + ganancia, cubriendo las comisiones activas; el IVA va aparte", () => {
    const b = suggestPrice(10, policy, 16)!;
    expect(b.rawNet).toBe(15.79);
    expect(b.net).toBe(15.79);
    expect(b.pvp).toBe(18.32);
    expect(b.tax).toBe(2.53);
    expect(b.concepts.map((c) => c.name)).toEqual(["Vendedor", "Punto de venta"]);
  });
  it("suma los gastos de traída al costo", () => {
    const b = suggestPrice(10, { ...policy, overhead_pct: 10, concepts: [] }, 0)!;
    expect(b.landed).toBe(11);
    expect(b.net).toBe(16.5);
  });
  it("redondea el PVP y guarda el precio sin IVA que lo da", () => {
    const b = suggestPrice(10, { ...policy, rounding: "99" }, 16)!;
    expect(b.pvp).toBe(18.99);
    expect(b.net).toBe(16.37);
  });
  it("sin costo o con comisiones imposibles no sugiere", () => {
    expect(suggestPrice(null, policy, 16)).toBeNull();
    expect(suggestPrice(0, policy, 16)).toBeNull();
    expect(suggestPrice(10, { ...policy, concepts: [{ name: "X", pct: 95, active: true }] }, 16)).toBeNull();
  });
});

describe("ganancia y descuento", () => {
  it("ganancia sobre el costo total después de comisiones", () => {
    expect(profitAt(20, 10, policy)).toEqual({ amount: 9, pct: 90 });
  });
  it("descuento máximo sin pérdida", () => {
    expect(maxDiscountNoLoss(20, 10, policy)).toBe(47.3);
    expect(maxDiscountNoLoss(5, 10, policy)).toBe(0);
  });
});

describe("priceStatus", () => {
  const v = { cost: 10, priced_cost: 10, regular_price: 20, price: 20 };
  it("en orden", () => expect(priceStatus(v, policy)).toBe("fijado"));
  it("sin costo y sin precio", () => {
    expect(priceStatus({ ...v, cost: null }, policy)).toBe("sin_costo");
    expect(priceStatus({ ...v, regular_price: null, price: null, priced_cost: null }, policy)).toBe("sin_fijar");
  });
  it("el costo cambió desde que se fijó", () => expect(priceStatus({ ...v, cost: 12 }, policy)).toBe("revisar"));
  it("la oferta deja pérdida o poco margen", () => {
    expect(priceStatus({ ...v, price: 10 }, policy)).toBe("perdida");
    expect(priceStatus({ ...v, price: 11.5 }, policy)).toBe("margen_bajo");
  });
  it("precios viejos sin costo fijado se juzgan por el margen", () => {
    expect(priceStatus({ ...v, priced_cost: null }, DEFAULT_POLICY)).toBe("fijado");
  });
});
