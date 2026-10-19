import { describe, expect, it } from "vitest";
import { attentionItems, shareOf, treasuryRange, type AttentionInput } from "./treasury";

describe("periodo del resumen", () => {
  it("hoy, semana desde el lunes, mes, año y todo", () => {
    // 2026-10-21 es miércoles.
    expect(treasuryRange("today", "2026-10-21")).toEqual({ from: "2026-10-21", to: "2026-10-21" });
    expect(treasuryRange("week", "2026-10-21")).toEqual({ from: "2026-10-19", to: "2026-10-21" });
    expect(treasuryRange("month", "2026-10-21")).toEqual({ from: "2026-10-01", to: "2026-10-21" });
    expect(treasuryRange("year", "2026-10-21")).toEqual({ from: "2026-01-01", to: "2026-10-21" });
    expect(treasuryRange("all", "2026-10-21")).toEqual({ from: null, to: "2026-10-21" });
  });

  it("un domingo cierra la semana que empezó el lunes", () => {
    expect(treasuryRange("week", "2026-10-25").from).toBe("2026-10-19");
  });
});

const calm: AttentionInput = {
  baseCurrency: "USD",
  overdueCount: 0,
  overdueTotal: 0,
  dueSoon: 0,
  negativeAccounts: [],
  unlinkedMethods: 0,
  rate: "ok",
  unconvertedMovements: 0,
  unconvertedCurrencies: [],
  bankUnmatched: 0,
  bankPossible: 0,
};

describe("requiere tu atención", () => {
  it("sin pendientes no hay avisos", () => {
    expect(attentionItems(calm)).toEqual([]);
  });

  it("ordena de más a menos grave", () => {
    const items = attentionItems({
      ...calm,
      overdueCount: 2,
      overdueTotal: 450,
      dueSoon: 3,
      negativeAccounts: ["Caja"],
      unlinkedMethods: 1,
      rate: "stale",
    });
    expect(items.map((i) => i.id)).toEqual(["overdue", "negative", "rate", "due_soon", "unlinked"]);
    expect(items[0].tone).toBe("critical");
    expect(items[0].target).toBe("obligations");
  });

  it("sin tasa no se puede convertir: aviso fuerte", () => {
    const [item] = attentionItems({ ...calm, rate: "missing" });
    expect(item).toMatchObject({ id: "rate", tone: "critical", target: "settings" });
  });

  it("líneas del banco por conciliar llevan a la conciliación", () => {
    const [item] = attentionItems({ ...calm, bankUnmatched: 2, bankPossible: 1 });
    expect(item).toMatchObject({ id: "bank", tone: "warning", target: "reconciliation" });
    expect(item.title).toBe("3 movimientos del banco por conciliar");
    expect(item.detail).toBe("2 sin identificar · 1 posible coincidencia");
  });

  it("montos que no se pudieron convertir", () => {
    const items = attentionItems({ ...calm, unconvertedMovements: 2, unconvertedCurrencies: ["EUR"] });
    expect(items.map((i) => i.id)).toEqual(["unconverted"]);
    expect(items[0].detail).toContain("EUR");
  });
});

describe("participación", () => {
  it("porcentaje sobre el total, sin dividir por cero", () => {
    expect(shareOf(25, 100)).toBe(25);
    expect(shareOf(5, 0)).toBe(0);
  });
});
