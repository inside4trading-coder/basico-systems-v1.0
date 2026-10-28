/**
 * Formatos de importación guardados (import_templates.mapping).
 *
 * v1: {"Columna": "campo"} — solo el cruce de columnas.
 * v2: {"version": 2, "sheets": [{name, headerRow, signature, columns, rules}]} —
 *     por hoja: fila de encabezado (desde 1), títulos normalizados para
 *     reconocer el formato, cruce y reglas.
 */
import { normalizeHeader, type ColumnMapping } from "./fields";
import { DEFAULT_RULES, type ImportRules } from "./rules";

export interface SheetFormat {
  name: string;
  headerRow: number;
  signature: string[];
  columns: ColumnMapping;
  rules: ImportRules;
}

export interface TemplateV2 {
  version: 2;
  sheets: SheetFormat[];
}

/** Cuántos títulos deben coincidir para aplicar un formato solo. */
const MATCH_RATIO = 0.8;

export function signatureOf(headers: string[]): string[] {
  return headers.map(normalizeHeader).filter(Boolean);
}

/** Lee lo guardado en cualquiera de los dos formatos. */
export function readTemplate(mapping: unknown): TemplateV2 {
  if (mapping && typeof mapping === "object" && (mapping as { version?: unknown }).version === 2) {
    const t = mapping as TemplateV2;
    return {
      version: 2,
      sheets: (t.sheets ?? []).map((s) => ({ ...s, rules: { ...DEFAULT_RULES, ...s.rules, defaults: { ...s.rules?.defaults } } })),
    };
  }
  const columns = Object.fromEntries(Object.entries((mapping ?? {}) as Record<string, string>).filter(([, v]) => typeof v === "string")) as ColumnMapping;
  return { version: 2, sheets: [{ name: "", headerRow: 0, signature: signatureOf(Object.keys(columns)), columns, rules: DEFAULT_RULES }] };
}

/** Qué tanto se parecen dos listas de títulos (0 a 1). */
export function similarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const set = new Set(b);
  const common = a.filter((h) => set.has(h)).length;
  return common / Math.max(a.length, b.length);
}

/** El formato guardado que mejor encaja con los títulos de una hoja, si encaja lo suficiente. */
export function findFormat<T extends { name: string; mapping: unknown }>(
  templates: T[],
  headers: string[],
): { template: T; format: SheetFormat } | null {
  const sig = signatureOf(headers);
  let best: { template: T; format: SheetFormat; score: number } | null = null;
  for (const template of templates) {
    for (const format of readTemplate(template.mapping).sheets) {
      const score = similarity(sig, format.signature);
      if (score >= MATCH_RATIO && (!best || score > best.score)) best = { template, format, score };
    }
  }
  return best && { template: best.template, format: best.format };
}

/** Solo las columnas con campo: lo vacío no se guarda. */
export function toTemplate(sheets: SheetFormat[]): TemplateV2 {
  return {
    version: 2,
    sheets: sheets.map((s) => ({ ...s, columns: Object.fromEntries(Object.entries(s.columns).filter(([, f]) => f !== "")) })),
  };
}
