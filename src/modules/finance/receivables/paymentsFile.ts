/**
 * Lectura del archivo de pagos de una financiadora (Fecha, Monto pagado en
 * VES/USD, Tasa, Referencia, Cuota, Orden, Factura). Portado de
 * parseCasheaPayments (basicosystems@9cb08cd).
 */
import { parseBankDate, parseBankNumber, type Cell } from "../bank/parse";

export interface FinancingPaymentRow {
  row: number;
  date: string | null;
  /** Monto en bolívares, como llega al banco. */
  amount_local: number;
  /** Monto en divisa que informa la financiadora. */
  amount_base: number | null;
  reference: string;
  installment: string;
  order: string;
  invoice: string;
}

const norm = (v: Cell) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const text = (v: Cell) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").trim());

/** Número con coma o punto decimal, como venga. */
function amount(v: Cell): number | null {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim();
  if (!s) return null;
  const comma = s.includes(",") && s.lastIndexOf(",") > s.lastIndexOf(".");
  return parseBankNumber(s, comma ? "comma" : "dot");
}

export const ORDERS_FILE_MESSAGE = "Este es el reporte de órdenes. Cárgalo en el paso 1; aquí va el archivo de pagos.";

export function parseFinancingPayments(table: Cell[][]): FinancingPaymentRow[] {
  const headerIndex = table.findIndex((r) => r.some((c) => norm(c).includes("montopagadoenves")));
  if (headerIndex < 0) {
    if (table.some((r) => r.some((c) => /^(montocuota|fechacuota)\d/.test(norm(c))))) throw new Error(ORDERS_FILE_MESSAGE);
    throw new Error("No parece el archivo de pagos: falta la columna «Monto pagado en VES».");
  }
  const head = table[headerIndex].map(norm);
  const col = (...keys: string[]) => head.findIndex((h) => keys.some((k) => h.includes(k)));
  const c = {
    date: col("fechadetransaccion", "fecha"),
    local: col("montopagadoenves"),
    base: col("montopagadoenusd"),
    ref: col("referencia"),
    installment: col("cuota"),
    order: col("orden"),
    invoice: col("factura"),
  };
  const missing = (
    [
      ["Fecha", c.date],
      ["Referencia", c.ref],
      ["Cuota", c.installment],
      ["Orden", c.order],
    ] as const
  )
    .filter(([, i]) => i < 0)
    .map(([n]) => n);
  if (missing.length) throw new Error(`Faltan columnas del archivo de pagos: ${missing.join(", ")}.`);

  const out: FinancingPaymentRow[] = [];
  table.slice(headerIndex + 1).forEach((r, i) => {
    const local = amount(r[c.local]);
    if (local === null || !(local > 0)) return;
    const base = c.base >= 0 ? amount(r[c.base]) : null;
    out.push({
      row: headerIndex + 2 + i,
      date: parseBankDate(r[c.date], "DMY"),
      amount_local: local,
      amount_base: base !== null && base > 0 ? base : null,
      reference: text(r[c.ref]),
      installment: text(r[c.installment]),
      order: text(r[c.order]),
      invoice: c.invoice >= 0 ? text(r[c.invoice]) : "",
    });
  });
  return out;
}
