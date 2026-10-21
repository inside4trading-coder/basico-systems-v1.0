/** Cuentas del reporte de IVA (public.report_tax), sin acceso a red. */

export interface TaxReportData {
  from: string;
  to: string;
  base_currency: string;
  sales: { rate: number; base: number; tax: number; lines: number }[];
  returns: { rate: number; base: number; tax: number }[];
  igtf: number;
  tickets: number;
}

export interface TaxRow {
  rate: number;
  base: number;
  tax: number;
  returnsBase: number;
  returnsTax: number;
  netBase: number;
  netTax: number;
}

function round2(value: number): number {
  return Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;
}

/** Una fila por tasa: lo vendido, lo devuelto y lo que queda (débito fiscal). */
export function taxRows(data: Pick<TaxReportData, "sales" | "returns">): TaxRow[] {
  const rates = new Set<number>([...data.sales.map((s) => Number(s.rate)), ...data.returns.map((r) => Number(r.rate))]);
  return [...rates]
    .sort((a, b) => b - a)
    .map((rate) => {
      const sold = data.sales.find((s) => Number(s.rate) === rate);
      const back = data.returns.find((r) => Number(r.rate) === rate);
      const base = Number(sold?.base ?? 0);
      const tax = Number(sold?.tax ?? 0);
      const returnsBase = Number(back?.base ?? 0);
      const returnsTax = Number(back?.tax ?? 0);
      return { rate, base, tax, returnsBase, returnsTax, netBase: round2(base - returnsBase), netTax: round2(tax - returnsTax) };
    });
}

export function taxTotals(rows: TaxRow[]) {
  const sum = (pick: (r: TaxRow) => number) => round2(rows.reduce((a, r) => a + pick(r), 0));
  return {
    taxable: sum((r) => (r.rate > 0 ? r.netBase : 0)),
    exempt: sum((r) => (r.rate > 0 ? 0 : r.netBase)),
    tax: sum((r) => r.netTax),
  };
}
