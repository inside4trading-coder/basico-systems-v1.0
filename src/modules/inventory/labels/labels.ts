/**
 * Etiquetas para imprimir, con plantillas: rollo térmico (una por etiqueta) u
 * hoja adhesiva (filas × columnas). Sirven para cualquier producto: el código
 * puede ser de barras, QR o ninguno, y cada campo se prende o apaga.
 *
 * La disposición se calcula en milímetros a partir del tamaño (como
 * getLabelLayout del ERP, basicosystems@f551478b): nada se sale del margen
 * seguro ni se encima, tenga la etiqueta la forma que tenga.
 */

export type LabelMedia = "roll" | "sheet";
export type LabelCodeKind = "barcode" | "qr" | "none";
export type LabelPage = "letter" | "a4";

export interface LabelTemplate {
  id: string;
  name: string;
  media: LabelMedia;
  width_mm: number;
  height_mm: number;
  page: LabelPage;
  columns: number;
  rows: number;
  code_kind: LabelCodeKind;
  show_header: boolean;
  header_text: string | null;
  show_tax_id: boolean;
  show_name: boolean;
  show_detail: boolean;
  show_sku: boolean;
  show_price: boolean;
  show_price_local: boolean;
  is_default: boolean;
}

export type LabelTemplateDraft = Omit<LabelTemplate, "id">;

/** Plantillas de fábrica: siempre disponibles, aunque el negocio no guarde ninguna. */
export const PRESET_TEMPLATES: LabelTemplate[] = [
  {
    id: "preset:roll-50x25",
    name: "Rollo térmico 50 × 25 mm",
    media: "roll",
    width_mm: 50,
    height_mm: 25,
    page: "letter",
    columns: 1,
    rows: 1,
    code_kind: "barcode",
    show_header: false,
    header_text: null,
    show_tax_id: false,
    show_name: true,
    show_detail: true,
    show_sku: false,
    show_price: true,
    show_price_local: false,
    is_default: false,
  },
  {
    id: "preset:sheet-letter-3x10",
    name: "Hoja carta 3 × 10",
    media: "sheet",
    width_mm: 66.7,
    height_mm: 25.4,
    page: "letter",
    columns: 3,
    rows: 10,
    code_kind: "barcode",
    show_header: false,
    header_text: null,
    show_tax_id: false,
    show_name: true,
    show_detail: true,
    show_sku: false,
    show_price: true,
    show_price_local: false,
    is_default: false,
  },
];

export const isPreset = (id: string) => id.startsWith("preset:");

export const CODE_KIND_LABEL: Record<LabelCodeKind, string> = {
  barcode: "Código de barras",
  qr: "Código QR",
  none: "Sin código",
};

export const PAGE_SIZE_MM: Record<LabelPage, { width: number; height: number; label: string }> = {
  letter: { width: 215.9, height: 279.4, label: "Carta" },
  a4: { width: 210, height: 297, label: "A4" },
};

/** Margen mínimo de la hoja (las impresoras no imprimen en el borde). */
export const SHEET_MARGIN_MM = 4;

export interface LabelItem {
  name: string;
  detail: string | null;
  sku: string | null;
  /** Valor del código (barras o QR). */
  code: string;
  price: string;
  priceLocal: string | null;
  /** SVG del código ya generado (barras o QR); vacío si la plantilla no lleva código. */
  codeSvg: string;
}

export interface LabelHeader {
  text: string;
  taxId: string | null;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LabelLayout {
  width: number;
  height: number;
  margin: number;
  header: Rect | null;
  code: Rect | null;
  /** Alto (mm) del texto bajo el código de barras. */
  codeTextHeight: number;
  text: Rect | null;
  nameLines: 1 | 2;
  /** Tamaños de letra en puntos. */
  fonts: { header: number; name: number; detail: number; sku: number; price: number; priceLocal: number; code: number };
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const MM_TO_PT = 72 / 25.4;
const LINE = 1.15;

/** Campos de texto que lleva la plantilla, con su peso relativo de tamaño. */
function textWeights(t: Pick<LabelTemplate, "show_name" | "show_detail" | "show_sku" | "show_price" | "show_price_local">, nameLines: number) {
  return (
    (t.show_name ? nameLines * 1 : 0) +
    (t.show_detail ? 0.8 : 0) +
    (t.show_sku ? 0.75 : 0) +
    (t.show_price ? 1.5 : 0) +
    (t.show_price && t.show_price_local ? 0.75 : 0)
  );
}

export function hasText(t: Pick<LabelTemplate, "show_name" | "show_detail" | "show_sku" | "show_price">): boolean {
  return t.show_name || t.show_detail || t.show_sku || t.show_price;
}

/** Geometría de una etiqueta: la comparten la impresión y la vista previa. */
export function labelLayout(t: LabelTemplateDraft | LabelTemplate): LabelLayout {
  const width = clamp(Number(t.width_mm) || 50, 15, 200);
  const height = clamp(Number(t.height_mm) || 25, 10, 200);
  const shortest = Math.min(width, height);
  const margin = clamp(shortest * 0.06, 1, 3);
  const gap = clamp(shortest * 0.04, 0.5, 2);
  const inner: Rect = { x: margin, y: margin, w: width - margin * 2, h: height - margin * 2 };

  let header: Rect | null = null;
  let body = inner;
  if (t.show_header) {
    const hh = clamp(height * 0.14, 2.5, 6);
    header = { x: inner.x, y: inner.y, w: inner.w, h: hh };
    body = { x: inner.x, y: inner.y + hh + gap, w: inner.w, h: Math.max(0, inner.h - hh - gap) };
  }

  const withText = hasText(t);
  let code: Rect | null = null;
  let text: Rect | null = withText ? body : null;
  let codeTextHeight = 0;

  if (t.code_kind === "barcode") {
    const ch = withText ? clamp(body.h * 0.42, 4, 18) : body.h;
    code = { x: body.x, y: body.y + body.h - ch, w: body.w, h: ch };
    codeTextHeight = clamp(ch * 0.24, 1.4, 3);
    text = withText ? { x: body.x, y: body.y, w: body.w, h: Math.max(0, body.h - ch - gap) } : null;
  } else if (t.code_kind === "qr") {
    if (!withText) {
      const q = Math.min(body.w, body.h);
      code = { x: body.x + (body.w - q) / 2, y: body.y + (body.h - q) / 2, w: q, h: q };
    } else if (body.w / Math.max(body.h, 0.01) >= 1.15) {
      const q = Math.min(body.h, body.w * 0.45);
      code = { x: body.x, y: body.y + (body.h - q) / 2, w: q, h: q };
      text = { x: body.x + q + gap, y: body.y, w: Math.max(0, body.w - q - gap), h: body.h };
    } else {
      const q = Math.min(body.w * 0.7, body.h * 0.55);
      code = { x: body.x + (body.w - q) / 2, y: body.y, w: q, h: q };
      text = { x: body.x, y: body.y + q + gap, w: body.w, h: Math.max(0, body.h - q - gap) };
    }
  }
  if (text && (text.w < 5 || text.h < 2.5)) text = null;

  // Letra: el texto llena su caja; el nombre usa dos líneas si cabe a 6 pt o más.
  let nameLines: 1 | 2 = 1;
  let base = 0;
  if (text) {
    const per = (lines: number) => (text!.h / (textWeights(t, lines) * LINE || 1)) * MM_TO_PT;
    nameLines = t.show_name && per(2) >= 6 ? 2 : 1;
    base = per(nameLines);
  }
  const name = clamp(base, 4, 11);
  const fonts = {
    header: header ? clamp(header.h * 0.62 * MM_TO_PT, 4, 9) : 0,
    name,
    detail: clamp(base * 0.8, 4, 9),
    sku: clamp(base * 0.75, 4, 8),
    price: clamp(base * 1.5, 5, 20),
    priceLocal: clamp(base * 0.75, 4, 9),
    code: clamp(codeTextHeight * 0.8 * MM_TO_PT, 4, 8),
  };
  return { width, height, margin, header, code, codeTextHeight, text, nameLines, fonts };
}

/** Alto (mm) que ocupan los textos con los tamaños calculados. */
export function textHeight(t: LabelTemplateDraft | LabelTemplate, layout: LabelLayout): number {
  const f = layout.fonts;
  const mm = (pt: number) => (pt / MM_TO_PT) * LINE;
  return (
    (t.show_name ? mm(f.name) * layout.nameLines : 0) +
    (t.show_detail ? mm(f.detail) : 0) +
    (t.show_sku ? mm(f.sku) : 0) +
    (t.show_price ? mm(f.price) : 0) +
    (t.show_price && t.show_price_local ? mm(f.priceLocal) : 0)
  );
}

/** ¿Caben las filas × columnas en la hoja? */
export function sheetFits(t: Pick<LabelTemplate, "media" | "page" | "columns" | "rows" | "width_mm" | "height_mm">): boolean {
  if (t.media !== "sheet") return true;
  const page = PAGE_SIZE_MM[t.page];
  return (
    t.columns * Number(t.width_mm) <= page.width - SHEET_MARGIN_MM * 2 + 0.01 &&
    t.rows * Number(t.height_mm) <= page.height - SHEET_MARGIN_MM * 2 + 0.01
  );
}

/** Qué impide guardar la plantilla; null si está bien. */
export function templateProblem(t: LabelTemplateDraft): string | null {
  if (!t.name.trim()) return "Ponle un nombre a la plantilla";
  if (!(t.width_mm >= 15 && t.width_mm <= 200)) return "El ancho va de 15 a 200 mm";
  if (!(t.height_mm >= 10 && t.height_mm <= 200)) return "El alto va de 10 a 200 mm";
  if (t.media === "sheet") {
    if (!(t.columns >= 1 && t.columns <= 8) || !(t.rows >= 1 && t.rows <= 30)) return "Entre 1 y 8 columnas y entre 1 y 30 filas";
    if (!sheetFits(t)) return `${t.columns} × ${t.rows} etiquetas de ese tamaño no caben en la hoja ${PAGE_SIZE_MM[t.page].label}`;
  }
  if (t.code_kind === "none" && !hasText(t)) return "La etiqueta tiene que llevar un código o algún texto";
  return null;
}

/** Repite cada producto tantas veces como etiquetas se pidieron (máximo 500 en total). */
export function expandLabels<T>(rows: { item: T; copies: number }[], max = 500): T[] {
  const out: T[] = [];
  for (const r of rows) {
    for (let i = 0; i < Math.max(0, Math.floor(r.copies)) && out.length < max; i++) out.push(r.item);
  }
  return out;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const box = (r: Rect) => `left:${r2(r.x)}mm;top:${r2(r.y)}mm;width:${r2(r.w)}mm;height:${r2(r.h)}mm;`;

/** Una etiqueta en HTML (posiciones absolutas en mm). */
export function labelHtml(item: LabelItem, t: LabelTemplateDraft | LabelTemplate, header: LabelHeader, layout = labelLayout(t)): string {
  const e = escapeHtml;
  const f = layout.fonts;
  const parts: string[] = [];
  if (layout.header) {
    parts.push(`<div class="hd" style="${box(layout.header)}font-size:${r2(f.header)}pt">
<span class="hd-t">${e(header.text)}</span>${t.show_tax_id && header.taxId ? `<span class="hd-r">RIF ${e(header.taxId)}</span>` : ""}</div>`);
  }
  if (layout.code && t.code_kind !== "none" && item.codeSvg) {
    parts.push(
      t.code_kind === "barcode"
        ? `<div class="cd bc" style="${box(layout.code)}"><div class="bc-s">${item.codeSvg}</div><div class="bc-t" style="height:${r2(layout.codeTextHeight)}mm;font-size:${r2(f.code)}pt">${e(item.code)}</div></div>`
        : `<div class="cd qr" style="${box(layout.code)}">${item.codeSvg}</div>`,
    );
  }
  if (layout.text) {
    const lines: string[] = [];
    if (t.show_name) lines.push(`<p class="nm" style="font-size:${r2(f.name)}pt;-webkit-line-clamp:${layout.nameLines}">${e(item.name)}</p>`);
    if (t.show_detail && item.detail) lines.push(`<p class="ln" style="font-size:${r2(f.detail)}pt">${e(item.detail)}</p>`);
    if (t.show_sku && item.sku) lines.push(`<p class="ln sk" style="font-size:${r2(f.sku)}pt">${e(item.sku)}</p>`);
    if (t.show_price && item.price) lines.push(`<p class="pr" style="font-size:${r2(f.price)}pt">${e(item.price)}</p>`);
    if (t.show_price && t.show_price_local && item.priceLocal) {
      lines.push(`<p class="ln pl" style="font-size:${r2(f.priceLocal)}pt">${e(item.priceLocal)}</p>`);
    }
    parts.push(`<div class="tx" style="${box(layout.text)}">${lines.join("")}</div>`);
  }
  return `<div class="label" style="width:${r2(layout.width)}mm;height:${r2(layout.height)}mm">${parts.join("")}</div>`;
}

export const LABEL_CSS = `
* { box-sizing: border-box; }
body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; }
.label { position: relative; overflow: hidden; background: #fff; }
.label > div { position: absolute; overflow: hidden; }
.hd { display: flex; align-items: center; justify-content: space-between; gap: 1mm; border-bottom: 0.25mm solid #000; font-weight: 700; }
.hd-t { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hd-r { flex-shrink: 0; font-weight: 400; white-space: nowrap; }
.bc { display: flex; flex-direction: column; }
.bc-s { flex: 1; min-height: 0; }
.bc-s svg { display: block; width: 100%; height: 100%; }
.bc-t { text-align: center; line-height: 1; letter-spacing: 0.04em; white-space: nowrap; overflow: hidden; }
.qr svg { display: block; width: 100%; height: 100%; }
.tx { display: flex; flex-direction: column; justify-content: center; }
.tx p { margin: 0; line-height: ${LINE}; overflow: hidden; }
.nm { font-weight: 700; display: -webkit-box; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
.ln { white-space: nowrap; text-overflow: ellipsis; }
.sk { font-family: "Courier New", monospace; }
.pr { font-weight: 700; white-space: nowrap; }
`;

/** Documento listo para imprimir con todas las etiquetas. */
export function labelsHtml(items: LabelItem[], t: LabelTemplateDraft | LabelTemplate, header: LabelHeader): string {
  const layout = labelLayout(t);
  const cells = items.map((it) => labelHtml(it, t, header, layout));
  let page: string;
  let body: string;
  if (t.media === "roll") {
    page = `@page { size: ${r2(layout.width)}mm ${r2(layout.height)}mm; margin: 0; } .label { page-break-after: always; } .label:last-child { page-break-after: auto; }`;
    body = cells.join("\n");
  } else {
    const size = PAGE_SIZE_MM[t.page];
    const perPage = Math.max(1, t.columns * t.rows);
    const offX = Math.max(SHEET_MARGIN_MM, (size.width - t.columns * layout.width) / 2);
    const offY = Math.max(SHEET_MARGIN_MM, (size.height - t.rows * layout.height) / 2);
    page = `@page { size: ${t.page === "a4" ? "A4" : "letter"}; margin: 0; }
.sheet { width: ${size.width}mm; height: ${size.height}mm; padding: ${r2(offY)}mm ${r2(offX)}mm; display: grid;
  grid-template-columns: repeat(${t.columns}, ${r2(layout.width)}mm); grid-auto-rows: ${r2(layout.height)}mm; align-content: start;
  page-break-after: always; overflow: hidden; }
.sheet:last-child { page-break-after: auto; }`;
    const sheets: string[] = [];
    for (let i = 0; i < cells.length; i += perPage) sheets.push(`<div class="sheet">${cells.slice(i, i + perPage).join("")}</div>`);
    body = sheets.join("\n");
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>Etiquetas</title><style>${page}${LABEL_CSS}</style></head><body>${body}</body></html>`;
}

/** Vista previa de una etiqueta (con borde), para un iframe. */
export function previewHtml(item: LabelItem, t: LabelTemplateDraft | LabelTemplate, header: LabelHeader): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${LABEL_CSS}
html, body { background: transparent; }
body { padding: 2mm; }
.label { outline: 0.3mm dashed #9aa3b5; }
</style></head><body>${labelHtml(item, t, header)}</body></html>`;
}
