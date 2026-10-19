import { itemLabel, parseOptions, periodStart, saleBlockers, sumStock, variantLabel } from "./lib";

describe("variantes", () => {
  it("un producto simple no muestra opciones", () => {
    expect(variantLabel({})).toBe("");
    expect(itemLabel("Martillo", {})).toBe("Martillo");
  });

  it("muestra las opciones en orden", () => {
    expect(itemLabel("Franela", { Talla: "M", Color: "Rojo" })).toBe("Franela — M · Rojo");
  });

  it("lee opciones escritas a mano e ignora pares incompletos", () => {
    expect(parseOptions("Talla: M, Color: Rojo")).toEqual({ Talla: "M", Color: "Rojo" });
    expect(parseOptions("Medida: 1/2 pulgada, sin dos puntos, : vacío")).toEqual({ Medida: "1/2 pulgada" });
    expect(parseOptions("")).toEqual({});
  });
});

describe("saleBlockers", () => {
  const ok = { product: { is_active: true }, variant: { is_active: true, price: 10, regular_price: 12 }, sellableStock: 1 };

  it("una variante activa, con precio y stock se puede vender", () => {
    expect(saleBlockers(ok)).toEqual([]);
  });

  it("usa el precio de lista si no hay precio vigente", () => {
    expect(saleBlockers({ ...ok, variant: { is_active: true, price: null, regular_price: 5 } })).toEqual([]);
  });

  it("lista todo lo que bloquea", () => {
    expect(
      saleBlockers({
        product: { is_active: false },
        variant: { is_active: false, price: 0, regular_price: null },
        sellableStock: 0,
      }),
    ).toEqual(["product_inactive", "variant_inactive", "no_price", "no_stock"]);
  });
});

describe("sumStock", () => {
  const stocks = [
    { location_id: "a", on_hand: 5, available: 4 },
    { location_id: "b", on_hand: 2.5, available: 2.5 },
  ];

  it("suma todas las sedes", () => {
    expect(sumStock(stocks)).toEqual({ onHand: 7.5, available: 6.5 });
  });

  it("o solo las indicadas", () => {
    expect(sumStock(stocks, new Set(["b"]))).toEqual({ onHand: 2.5, available: 2.5 });
  });
});

describe("periodStart", () => {
  const wednesday = new Date(2026, 9, 21, 15, 30);

  it("la semana empieza el lunes", () => {
    expect(new Date(periodStart("week", wednesday)!).getDate()).toBe(19);
  });

  it("el mes empieza el día 1 y 'todo' no tiene inicio", () => {
    expect(new Date(periodStart("month", wednesday)!).getDate()).toBe(1);
    expect(periodStart("all", wednesday)).toBeNull();
  });
});
