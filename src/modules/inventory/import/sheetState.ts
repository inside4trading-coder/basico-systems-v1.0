/**
 * Estado de cada hoja en la pantalla de importación y las cuentas que se
 * derivan de él (sin React, para poder probarlas).
 */
import { attributeKey, splitField, suggestMapping, type ColumnMapping, type TargetField } from "./fields";
import { detectHeaderRow, tableToSheet, type ParsedSheet, type RawSheet } from "./files";
import { DEFAULT_RULES, type ImportRules } from "./rules";
import type { SheetFormat } from "./templates";

export interface SheetState {
  name: string;
  table: string[][];
  include: boolean;
  /** Fila de títulos, desde 0. */
  headerIndex: number;
  parsed: ParsedSheet;
  mapping: ColumnMapping;
  rules: ImportRules;
}

export interface MappingContext {
  locationCodes: string[];
  defaultLocationCode: string | null;
  attributes: { key: string; label: string }[];
}

/** "UBICACIÓN" → "Ubicación"; "Peso neto" se queda igual. */
export function prettyLabel(header: string): string {
  const h = header.trim();
  return h === h.toLocaleUpperCase("es") ? h.charAt(0) + h.slice(1).toLocaleLowerCase("es") : h;
}

/** Hoja recién leída: encabezado detectado, cruce sugerido o el del formato guardado. */
export function initSheet(raw: RawSheet, ctx: MappingContext, format?: SheetFormat | null): SheetState {
  const headerIndex = format && format.headerRow > 0 ? format.headerRow - 1 : detectHeaderRow(raw.table);
  const parsed = tableToSheet(raw.table, headerIndex);
  const mapping = format
    ? (Object.fromEntries(parsed.headers.map((h) => [h, format.columns[h] ?? ""])) as ColumnMapping)
    : suggestMapping(parsed.headers, ctx);
  return {
    name: raw.name,
    table: raw.table,
    include: parsed.rows.length > 0,
    headerIndex,
    parsed,
    mapping,
    rules: format ? format.rules : DEFAULT_RULES,
  };
}

/** Cambia la fila de títulos: se rehace la hoja y se vuelve a sugerir el cruce. */
export function withHeaderRow(sheet: SheetState, headerIndex: number, ctx: MappingContext): SheetState {
  const parsed = tableToSheet(sheet.table, headerIndex);
  return { ...sheet, headerIndex, parsed, mapping: suggestMapping(parsed.headers, ctx) };
}

/** Asigna una columna a un campo; el campo deja la columna que tenía antes. */
export function assignField(mapping: ColumnMapping, field: TargetField, header: string | ""): ColumnMapping {
  const next = { ...mapping };
  for (const h of Object.keys(next)) if (next[h] === field) next[h] = "";
  if (header) next[header] = field;
  return next;
}

export function columnOf(mapping: ColumnMapping, field: TargetField): string {
  return Object.keys(mapping).find((h) => mapping[h] === field) ?? "";
}

/** Celdas vacías y valores repetidos de una columna. */
export function columnStats(sheet: ParsedSheet, header: string) {
  if (!header) return { empty: sheet.rows.length, repeated: 0 };
  const counts = new Map<string, number>();
  let empty = 0;
  for (const row of sheet.rows) {
    const v = (row[header] ?? "").trim().toLocaleUpperCase("es");
    if (!v) empty++;
    else counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let repeated = 0;
  for (const n of counts.values()) if (n > 1) repeated += n - 1;
  return { empty, repeated };
}

/** Columna para «Guardar como dato extra». */
export function extraField(header: string): TargetField {
  return `attr:${attributeKey(header)}`;
}

/**
 * Reglas efectivas: si se genera SKU y la columna de SKU se repite, su valor
 * original se guarda en un campo propio buscable con el título de la columna.
 */
export function effectiveRules(sheet: SheetState): ImportRules {
  const skuHeader = columnOf(sheet.mapping, "sku");
  if (!sheet.rules.autoSku || !skuHeader || columnStats(sheet.parsed, skuHeader).repeated === 0) return { ...sheet.rules, keepCodeAs: null };
  return { ...sheet.rules, keepCodeAs: attributeKey(skuHeader) };
}

/** Campos propios que el cruce necesita y no existen todavía. */
export function pendingAttributes(sheets: SheetState[], existingKeys: string[]): { key: string; label: string }[] {
  const known = new Set(existingKeys);
  const out = new Map<string, string>();
  for (const s of sheets.filter((x) => x.include)) {
    for (const [header, field] of Object.entries(s.mapping)) {
      const [kind, key] = splitField(field);
      if (kind === "attr" && !known.has(key)) out.set(key, prettyLabel(header));
    }
    const keep = effectiveRules(s).keepCodeAs;
    if (keep && !known.has(keep)) out.set(keep, prettyLabel(columnOf(s.mapping, "sku")));
  }
  return Array.from(out, ([key, label]) => ({ key, label }));
}

/** Columna de existencia de la hoja cuando hay una sola (la de «¿En qué sede?»). */
export function stockColumn(mapping: ColumnMapping): { header: string; location: string } | null {
  const stock = Object.entries(mapping).filter(([, f]) => f.startsWith("stock:"));
  if (stock.length !== 1) return null;
  return { header: stock[0][0], location: splitField(stock[0][1])[1] };
}

/** Lleva la columna de existencia a otra sede. */
export function moveStockTo(mapping: ColumnMapping, location: string): ColumnMapping {
  const current = stockColumn(mapping);
  if (!current) return mapping;
  return { ...mapping, [current.header]: `stock:${location}` };
}
