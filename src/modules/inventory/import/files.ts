/**
 * Lectura de Excel/CSV y escritura de Excel. Se usan read-excel-file y
 * write-excel-file en vez de `xlsx` 0.18 (la versión de npm), que tiene
 * vulnerabilidades al leer archivos de terceros.
 */
import Papa from "papaparse";
import readXlsxFile from "read-excel-file/browser";
import writeXlsxFile, { type SheetData } from "write-excel-file/browser";
import type { RawRow } from "./preview";

export const MAX_ROWS = 20000;

export interface ParsedSheet {
  headers: string[];
  rows: RawRow[];
  /** Número de fila (1 = primera) donde empiezan los datos, para los mensajes. */
  firstDataRow: number;
}

function cellToString(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "boolean") return value ? "Sí" : "No";
  return String(value).trim();
}

/** Toma la primera fila con contenido como encabezado; descarta filas vacías. */
export function tableToSheet(table: unknown[][]): ParsedSheet {
  const headerIndex = table.findIndex((row) => row.some((cell) => cellToString(cell) !== ""));
  if (headerIndex < 0) return { headers: [], rows: [], firstDataRow: 2 };

  const seen = new Map<string, number>();
  const headers = table[headerIndex].map((cell, i) => {
    const base = cellToString(cell) || `Columna ${i + 1}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count > 1 ? `${base} (${count})` : base;
  });

  const rows: RawRow[] = [];
  for (const row of table.slice(headerIndex + 1)) {
    const values = headers.map((_, i) => cellToString(row[i]));
    if (values.every((v) => v === "")) continue;
    rows.push(Object.fromEntries(headers.map((h, i) => [h, values[i]])));
  }
  return { headers, rows, firstDataRow: headerIndex + 2 };
}

export async function readSpreadsheet(file: File): Promise<ParsedSheet> {
  let table: unknown[][];
  if (/\.xlsx$/i.test(file.name)) {
    const sheets = await readXlsxFile(file);
    const sheet = sheets.find((s) => /^productos?$/i.test(s.sheet.trim())) ?? sheets[0];
    table = (sheet?.data ?? []) as unknown[][];
  } else if (/\.(csv|txt)$/i.test(file.name)) {
    const text = await file.text();
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
    table = parsed.data;
  } else {
    throw new Error("Usa un archivo .xlsx o .csv. Si tienes .xls, ábrelo en Excel y guárdalo como .xlsx.");
  }
  const sheet = tableToSheet(table);
  if (sheet.rows.length > MAX_ROWS) {
    throw new Error(`El archivo tiene ${sheet.rows.length} filas; el máximo es ${MAX_ROWS}. Divídelo en partes.`);
  }
  return sheet;
}

export async function hashFile(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
