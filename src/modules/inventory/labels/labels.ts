/**
 * Etiquetas de precio con código de barras para imprimir. Portado (en
 * versión simple, sin QR por unidad) de SublimeEtiquetas y
 * sublimeLabelPrint (basicosystems@f551478b).
 *
 * El código de barras es el código "barcode" del producto o, si no tiene, el
 * SKU. Formatos: rollo térmico de 50 × 25 mm (una por etiqueta) u hoja carta
 * con 3 × 10 etiquetas adhesivas.
 */

export type LabelFormat = "thermal" | "sheet";

export interface LabelItem {
  name: string;
  detail: string | null;
  code: string;
  price: string;
  priceLocal: string | null;
  /** SVG del código de barras ya generado. */
  barcodeSvg: string;
}

export const LABEL_FORMAT_LABEL: Record<LabelFormat, string> = {
  thermal: "Rollo térmico 50 × 25 mm",
  sheet: "Hoja carta 3 × 10",
};

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

export function labelsHtml(items: LabelItem[], format: LabelFormat): string {
  const e = escapeHtml;
  const page =
    format === "thermal"
      ? "@page { size: 50mm 25mm; margin: 0; } .label { width: 50mm; height: 25mm; page-break-after: always; }"
      : "@page { size: letter; margin: 12mm 5mm; } .sheet { display: grid; grid-template-columns: repeat(3, 1fr); } .label { height: 25.4mm; }";
  const labels = items
    .map(
      (it) => `<div class="label">
<p class="name">${e(it.name)}</p>
${it.detail ? `<p class="detail">${e(it.detail)}</p>` : ""}
<div class="code">${it.barcodeSvg}</div>
<p class="price">${e(it.price)}${it.priceLocal ? ` <small>${e(it.priceLocal)}</small>` : ""}</p>
</div>`,
    )
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Etiquetas</title><style>
${page}
* { box-sizing: border-box; }
body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; }
.label { overflow: hidden; padding: 1.5mm 2mm; display: flex; flex-direction: column; justify-content: space-between; }
.name { margin: 0; font-size: 8pt; font-weight: 700; line-height: 1.1; max-height: 2.2em; overflow: hidden; }
.detail { margin: 0; font-size: 6.5pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.code svg { display: block; width: 100%; height: 9mm; }
.price { margin: 0; font-size: 11pt; font-weight: 700; text-align: right; }
.price small { font-size: 7pt; font-weight: 400; }
</style></head><body>${format === "sheet" ? `<div class="sheet">${labels}</div>` : labels}</body></html>`;
}
