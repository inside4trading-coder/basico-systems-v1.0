/**
 * Lectura del reporte de órdenes de una financiadora (el de Cashea u otro con
 * las mismas columnas). Portado de src/lib/casheaImport.ts
 * (basicosystems@f551478b): se busca la fila de cabecera, se reconocen las
 * columnas por nombre y las cuotas "Monto/Fecha/Estado cuota N".
 */
import { parseBankDate, parseBankNumber, type Cell } from "../bank/parse";

export interface FinancingInstallment {
  number: number;
  due_date: string | null;
  amount: number;
  status: string | null;
}

export interface FinancingRow {
  external_ref: string | null;
  document: string | null;
  customer_name: string | null;
  issued_on: string | null;
  sale_total: number | null;
  initial_amount: number;
  installments: FinancingInstallment[];
}

const fold = (v: Cell) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[#º°ª.]/g, " ")
    .replace(/\bn\b|\bnro\b|\bnumero\b|\bno\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const FIELDS = {
  external_ref: ["orden", "de orden", "order"],
  document: ["factura", "de factura", "invoice"],
  customer_name: ["nombre del comprador", "comprador", "cliente", "nombre cliente", "customer"],
  sale_total: ["venta total", "total venta", "monto total", "total"],
  initial_amount: ["pago en caja", "pago inicial", "inicial"],
  issued_on: ["fecha compra", "fecha de compra", "fecha"],
} as const;

const text = (v: Cell) => {
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").trim();
  return s && !/^-+$/.test(s) ? s : null;
};

export function parseFinancingTable(table: Cell[][]): { rows: FinancingRow[]; skipped: number } {
  const headerIndex = table.findIndex((row) => row.some((c) => FIELDS.external_ref.includes(fold(c) as never)));
  if (headerIndex < 0) throw new Error("No se encontró la columna del n.º de orden. Revisa que sea el reporte de órdenes.");
  const header = table[headerIndex].map(fold);
  const col = (names: readonly string[]) => header.findIndex((h) => names.includes(h));
  const idx = Object.fromEntries(Object.entries(FIELDS).map(([k, names]) => [k, col(names)])) as Record<keyof typeof FIELDS, number>;
  const installmentCols: { number: number; amount: number; due: number; status: number }[] = [];
  for (let n = 1; n <= 24; n++) {
    const amount = col([`monto cuota ${n}`, `cuota ${n} monto`]);
    const due = col([`fecha cuota ${n}`, `cuota ${n} fecha`]);
    const status = col([`estado cuota ${n}`, `cuota ${n} estado`]);
    if (amount >= 0 || due >= 0) installmentCols.push({ number: n, amount, due, status });
  }
  const at = (row: Cell[], i: number): Cell => (i >= 0 ? row[i] : null);

  const rows: FinancingRow[] = [];
  let skipped = 0;
  for (const row of table.slice(headerIndex + 1)) {
    if (!row.some((c) => text(c))) continue;
    const external_ref = text(at(row, idx.external_ref));
    const document = text(at(row, idx.document));
    if (!external_ref && !document) {
      skipped++;
      continue;
    }
    const installments: FinancingInstallment[] = [];
    for (const c of installmentCols) {
      const amount = parseBankNumber(at(row, c.amount), "comma");
      if (amount === null || amount <= 0) continue;
      installments.push({
        number: c.number,
        due_date: parseBankDate(at(row, c.due), "DMY"),
        amount,
        status: text(at(row, c.status))?.toUpperCase() ?? null,
      });
    }
    rows.push({
      external_ref,
      document,
      customer_name: text(at(row, idx.customer_name)),
      issued_on: parseBankDate(at(row, idx.issued_on), "DMY"),
      sale_total: parseBankNumber(at(row, idx.sale_total), "comma"),
      initial_amount: parseBankNumber(at(row, idx.initial_amount), "comma") ?? 0,
      installments,
    });
  }
  return { rows, skipped };
}
