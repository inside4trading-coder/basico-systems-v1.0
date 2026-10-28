/**
 * Lectura de Excel/CSV y escritura de Excel. Se usan read-excel-file y
 * write-excel-file en vez de `xlsx` 0.18 (la versión de npm), que tiene
 * vulnerabilidades al leer archivos de terceros.
 */
import Papa from "papaparse";
import readXlsxFile from "read-excel-file/browser";
import writeXlsxFile, { type SheetData } from "write-excel-file/browser";
import { headerScore } from "./fields";
import type { RawRow } from "./preview";

export const MAX_ROWS = 20000;

/** Filas donde se busca el encabezado. */
const HEADER_SCAN_ROWS = 20;

export interface ParsedSheet {
  headers: string[];
  rows: RawRow[];
  /** Número de fila (1 = primera) donde empiezan los datos, para los mensajes. */
  firstDataRow: number;
  /** Número de fila en el archivo de cada registro de `rows`. */
  rowNumbers: number[];
}

/** Hoja tal como viene: celdas como texto, sin columnas ni filas vacías al final. */
export interface RawSheet {
  name: string;
  table: string[][];
}

/**
 * Celda a texto. Los números con decimales se escriben con coma ("18,58") para
 * que parseAmount no lea "12.345" como doce mil.
 */
export function cellToString(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "number") {
    if (Number.isInteger(value)) return String(value);
    return String(Math.round(value * 1e6) / 1e6).replace(".", ",");
  }
  return String(value).trim();
}

/** "A", "B", … "Z", "AA". */
export function columnLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Pasa las celdas a texto y quita las columnas y filas vacías del final (formato fantasma). */
export function trimTable(table: unknown[][]): string[][] {
  const rows = table.map((row) => (row ?? []).map(cellToString));
  let width = 0;
  for (const row of rows) {
    for (let i = row.length - 1; i >= width; i--) {
      if (row[i] !== "") {
        width = i + 1;
        break;
      }
    }
  }
  let height = rows.length;
  while (height > 0 && rows[height - 1].every((c) => c === "")) height--;
  return rows.slice(0, height).map((row) => Array.from({ length: width }, (_, i) => row[i] ?? ""));
}

const isNumeric = (cell: string) => /^-?[\d.,]+$/.test(cell);

/**
 * Fila de encabezado (índice desde 0): la que más se parece a títulos de
 * columna. Una fila de tasas arriba ("BCV", "Bs.") pierde contra la de
 * "Código, Descripción, Precio…".
 */
export function detectHeaderRow(table: string[][]): number {
  let best = -1;
  let bestScore = -Infinity;
  table.slice(0, HEADER_SCAN_ROWS).forEach((row, i) => {
    const filled = row.filter((c) => c !== "");
    if (filled.length === 0) return;
    const text = filled.filter((c) => !isNumeric(c));
    const score = filled.reduce((sum, c) => sum + headerScore(c) * 3, 0) + text.length - (filled.length - text.length);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return Math.max(0, best);
}

/** Nombre visible de una columna: su título, o la letra si no tiene o es un número. */
function headerName(cell: string, index: number): string {
  if (!cell) return `Columna ${columnLetter(index)}`;
  if (isNumeric(cell)) return `Columna ${columnLetter(index)} (${cell})`;
  return cell;
}

/**
 * Arma la hoja con el encabezado en `headerIndex` (por defecto, el detectado).
 * Descarta filas vacías y columnas sin título ni datos.
 */
export function tableToSheet(input: unknown[][], headerIndex?: number): ParsedSheet {
  const table = trimTable(input);
  if (table.length === 0) return { headers: [], rows: [], firstDataRow: 2, rowNumbers: [] };
  const index = headerIndex ?? detectHeaderRow(table);
  const body = table.slice(index + 1).filter((row) => row.some((c) => c !== ""));
  const columns = table[index]
    .map((cell, i) => ({ cell, i }))
    .filter(({ cell, i }) => cell !== "" || body.some((row) => row[i] !== ""));

  const seen = new Map<string, number>();
  const headers = columns.map(({ cell, i }) => {
    const base = headerName(cell, i);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count > 1 ? `${base} (${count})` : base;
  });

  const rows: RawRow[] = [];
  const rowNumbers: number[] = [];
  table.slice(index + 1).forEach((row, offset) => {
    if (row.every((c) => c === "")) return;
    rows.push(Object.fromEntries(columns.map(({ i }, k) => [headers[k], row[i] ?? ""])));
    rowNumbers.push(index + 2 + offset);
  });
  return { headers, rows, firstDataRow: index + 2, rowNumbers };
}

/** Todas las hojas del archivo (un CSV es una sola hoja). */
export async function readWorkbook(file: File): Promise<RawSheet[]> {
  let sheets: RawSheet[];
  if (/\.xlsx$/i.test(file.name)) {
    const raw = await readXlsxFile(file);
    sheets = raw.map((s) => ({ name: s.sheet.trim() || "Hoja", table: trimTable(s.data as unknown[][]) }));
  } else if (/\.(csv|txt)$/i.test(file.name)) {
    const text = await file.text();
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
    sheets = [{ name: file.name.replace(/\.[^.]+$/, ""), table: trimTable(parsed.data) }];
  } else {
    throw new Error("Usa un archivo .xlsx o .csv. Si tienes .xls, ábrelo en Excel y guárdalo como .xlsx.");
  }
  const total = sheets.reduce((sum, s) => sum + s.table.length, 0);
  if (total > MAX_ROWS) {
    throw new Error(`El archivo tiene ${total} filas; el máximo es ${MAX_ROWS}. Divídelo en partes.`);
  }
  return sheets;
}

export async function sha256Hex(data: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashFile(file: File): Promise<string> {
  return sha256Hex(await file.arrayBuffer());
}

type Cell = string | number | boolean | null;

/** Descarga un Excel de una hoja con encabezado en negrita. */
export async function downloadXlsx(fileName: string, headers: string[], rows: Cell[][], sheetName = "Productos") {
  const data: SheetData = [
    headers.map((h) => ({ value: h, fontWeight: "bold" as const })),
    ...rows.map((row) => row.map((value) => (value == null || value === "" ? null : { value }))),
  ];
  await writeXlsxFile(data, {
    sheet: sheetName,
    stickyRowsCount: 1,
    columns: headers.map((h) => ({ width: Math.min(40, Math.max(12, h.length + 4)) })),
  }).toFile(fileName);
}

/** CSV con separador ";" y BOM, para que Excel en español lo abra bien. */
export function downloadCsv(fileName: string, headers: string[], rows: Cell[][]) {
  const csv = Papa.unparse({ fields: headers, data: rows.map((r) => r.map((v) => (v == null ? "" : String(v)))) }, { delimiter: ";" });
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
