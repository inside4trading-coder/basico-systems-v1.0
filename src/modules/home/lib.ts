/** Cálculos del tablero de inicio. Portado de SublimeDashboard (basicosystems@f551478b). */

export interface ProductSale {
  variant_id: string | null;
  manual?: boolean;
  name: string;
  qty: number;
  net: number;
  profit: number | null;
  costed: boolean;
}

export interface Grower {
  key: string;
  name: string;
  net: number;
  previous: number;
  growth: number;
}

const keyOf = (p: ProductSale) => p.variant_id ?? `manual:${p.name.toLowerCase()}`;

/** Los que más vendieron (monto), sin conceptos manuales. */
export function topSellers(rows: ProductSale[], n = 5): ProductSale[] {
  return rows.filter((r) => !r.manual).sort((a, b) => b.net - a.net).slice(0, n);
}

/** Los que más dejaron (utilidad conocida). */
export function topProfit(rows: ProductSale[], n = 5): ProductSale[] {
  return rows
    .filter((r) => !r.manual && r.costed && r.profit !== null && r.profit > 0)
    .sort((a, b) => (b.profit ?? 0) - (a.profit ?? 0))
    .slice(0, n);
}

/** Los que más crecieron en monto frente al periodo anterior de igual duración. */
export function growers(current: ProductSale[], previous: ProductSale[], n = 5): Grower[] {
  const before = new Map(previous.map((p) => [keyOf(p), p.net]));
  return current
    .filter((c) => !c.manual)
    .map((c) => {
      const prev = before.get(keyOf(c)) ?? 0;
      return { key: keyOf(c), name: c.name, net: c.net, previous: prev, growth: c.net - prev };
    })
    .filter((g) => g.growth > 0)
    .sort((a, b) => b.growth - a.growth)
    .slice(0, n);
}

