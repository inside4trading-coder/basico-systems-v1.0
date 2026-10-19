/**
 * Lectura de estados de cuenta con un perfil de importación. Portado de
 * src/lib/sublimeBankImport.ts (basicosystems@f551478b). No conoce ningún
 * banco: columnas, formatos y signo salen del perfil. Los duplicados los
 * decide el servidor (import_bank_statement).
 */
import Papa from "papaparse";
import readXlsxFile from "read-excel-file/browser";

export type DateFormat = "DMY" | "MDY" | "YMD";
export type DecimalSeparator = "comma" | "dot";
export type AmountSign = "positive_in" | "positive_out";

export interface BankProfileSpec {
  start_row: number;
  col_date: string;
  col_time: string | null;
  col_reference: string | null;
  col_operation: string | null;
  col_description: string | null;
  col_debit: string | null;
  col_credit: string | null;
  col_amount: string | null;
  col_balance: string | null;
  date_format: DateFormat;
  decimal_separator: DecimalSeparator;
  amount_sign: AmountSign;
}

export type Cell = string | number | boolean | Date | null | undefined;

export interface BankRow {
  row: number;
  date: string;
  time: string | null;
  direction: "in" | "out";
  amount: number;
  reference: string | null;
  operation: string | null;
  description: string | null;
  balance: number | null;
  raw: Record<string, string>;
}

export interface BankRowError {
  row: number;
  reason: string;
}

export interface BankParseResult {
  rowsRead: number;
  rows: BankRow[];
  errors: BankRowError[];
}

const MAX_ROW = 5000;

const fold = (v: string) =>
  v
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

function cellText(v: Cell): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

/** Columna por letra (A, AA), número (1 = primera) o nombre de cabecera. */
export function resolveColumn(spec: string | null, header: Cell[]): number | null {
  const s = (spec ?? "").trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s) - 1;
  const byHeader = header.findIndex((h) => fold(cellText(h)) === fold(s));
  if (byHeader >= 0) return byHeader;
  if (!/^[A-Za-z]{1,3}$/.test(s)) return null;
  let n = 0;
  for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * El separador decimal se detecta por celda (hay bancos que exportan
 * 129,135.00 aunque el resto use coma); el perfil solo desempata 1.250.
 */
export function parseBankNumber(raw: Cell, separator: DecimalSeparator): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = cellText(raw);
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[^\d,.\-+]/g, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  s = s.replace(/[+-]/g, "");
  if (!s) return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let decimal: "." | "," | null;
  if (lastDot >= 0 && lastComma >= 0) decimal = lastDot > lastComma ? "." : ",";
  else if (lastDot < 0 && lastComma < 0) decimal = null;
  else {
    const sep = lastDot >= 0 ? "." : ",";
    const count = s.split(sep).length - 1;
    const tail = s.length - s.lastIndexOf(sep) - 1;
    if (count > 1) decimal = null;
    else if (tail !== 3) decimal = sep;
    else decimal = (separator === "dot" ? "." : ",") === sep ? sep : null;
  }
  if (decimal === null) s = s.replace(/[.,]/g, "");
  else s = s.split(decimal === "." ? "," : ".").join("").replace(decimal, ".");
  const value = Number(s);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

export function parseBankDate(raw: Cell, format: DateFormat): string | null {
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    // Excel guarda la fecha a medianoche UTC; se suma medio día para no saltar de día.
    return new Date(raw.getTime() + 12 * 3600 * 1000).toISOString().slice(0, 10);
  }
  const s = cellText(raw);
  const iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  let y: string, m: string, d: string;
  if (iso) [, y, m, d] = iso;
  else {
    const parts = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (!parts) return null;
    const [, a, b, yy] = parts;
    y = yy.length === 2 ? `20${yy}` : yy;
    [d, m] = format === "MDY" ? [b, a] : [a, b];
  }
  const day = Number(d);
  const month = Number(m);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const out = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return new Date(`${out}T12:00:00Z`).toISOString().slice(0, 10) === out ? out : null;
}

function parseTime(raw: Cell): string | null {
  const m = cellText(raw).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}:${m[3] ?? "00"}` : null;
}

export function parseBankTable(table: Cell[][], p: BankProfileSpec): BankParseResult {
  const start = Math.max(1, p.start_row || 2);
  const header = start >= 2 ? (table[start - 2] ?? []) : [];
  const col = {
    date: resolveColumn(p.col_date, header),
    time: resolveColumn(p.col_time, header),
    reference: resolveColumn(p.col_reference, header),
    operation: resolveColumn(p.col_operation, header),
    description: resolveColumn(p.col_description, header),
    debit: resolveColumn(p.col_debit, header),
    credit: resolveColumn(p.col_credit, header),
    amount: resolveColumn(p.col_amount, header),
    balance: resolveColumn(p.col_balance, header),
  };
  const at = (cols: Cell[], i: number | null): Cell => (i === null || i < 0 ? null : cols[i]);
  const text = (cols: Cell[], i: number | null) => cellText(at(cols, i)) || null;

  const rows: BankRow[] = [];
  const errors: BankRowError[] = [];
  let rowsRead = 0;

  table.slice(start - 1, MAX_ROW).forEach((cols, offset) => {
    const row = start + offset;
    if (!cols.some((c) => cellText(c) !== "")) return;
    rowsRead++;
    const raw: Record<string, string> = {};
    cols.forEach((c, i) => {
      const key = cellText(header[i]) || `col_${i + 1}`;
      raw[key] = cellText(c);
    });

    const date = parseBankDate(at(cols, col.date), p.date_format);
    if (!date) return errors.push({ row, reason: `Fecha ilegible ("${cellText(at(cols, col.date))}")` });

    let direction: "in" | "out";
    let amount: number;
    const debit = col.debit === null ? null : parseBankNumber(at(cols, col.debit), p.decimal_separator);
    const credit = col.credit === null ? null : parseBankNumber(at(cols, col.credit), p.decimal_separator);
    if ((debit ?? 0) !== 0 || (credit ?? 0) !== 0) {
      if ((debit ?? 0) !== 0 && (credit ?? 0) !== 0) return errors.push({ row, reason: "Débito y crédito a la vez: dirección ambigua" });
      direction = (credit ?? 0) !== 0 ? "in" : "out";
      amount = Math.abs((credit ?? 0) || (debit ?? 0));
    } else if (col.amount !== null) {
      const single = parseBankNumber(at(cols, col.amount), p.decimal_separator);
      if (single === null || single === 0) return errors.push({ row, reason: "Monto vacío o no numérico" });
      const positiveIn = p.amount_sign !== "positive_out";
      direction = single > 0 === positiveIn ? "in" : "out";
      amount = Math.abs(single);
    } else {
      return errors.push({ row, reason: "Sin monto en débito ni crédito" });
    }

    rows.push({
      row,
      date,
      time: parseTime(at(cols, col.time)),
      direction,
      amount: Math.round(amount * 100) / 100,
      reference: text(cols, col.reference),
      operation: text(cols, col.operation),
      description: text(cols, col.description),
      balance: col.balance === null ? null : parseBankNumber(at(cols, col.balance), p.decimal_separator),
      raw,
    });
  });

  return { rowsRead, rows, errors };
}

/**
 * Tabla tal cual (filas vacías incluidas, para que los números de fila
 * coincidan con Excel). CSV, XLSX y la tabla HTML que algunos bancos
 * exportan con extensión .xls.
 */
export async function readBankFile(file: File, sheetName?: string | null): Promise<Cell[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    return Papa.parse<string[]>(await file.text(), { skipEmptyLines: false }).data;
  }
  if (name.endsWith(".xls") || name.endsWith(".html") || name.endsWith(".htm")) {
    const html = await file.text();
    if (!html.trimStart().startsWith("<")) {
      throw new Error("Este .xls es del formato antiguo de Excel. Ábrelo en Excel y guárdalo como .xlsx o .csv.");
    }
    const doc = new DOMParser().parseFromString(html, "text/html");
    return Array.from(doc.querySelectorAll("tr")).map((tr) => Array.from(tr.querySelectorAll("td,th")).map((td) => (td.textContent ?? "").trim()));
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xlsm")) {
    const sheets = await readXlsxFile(file);
    const wanted = (sheetName ?? "").trim();
    const sheet = wanted
      ? /^\d+$/.test(wanted)
        ? sheets[Number(wanted) - 1]
        : sheets.find((s) => fold(s.sheet) === fold(wanted))
      : sheets[0];
    if (!sheet) throw new Error(`No existe la hoja "${wanted}". Hojas del archivo: ${sheets.map((s) => s.sheet).join(", ")}`);
    return sheet.data as Cell[][];
  }
  throw new Error("Usa un archivo .csv, .xlsx o el .xls que exporta el banco.");
}
