import { describe, expect, it } from "vitest";
import {
  PRESET_TEMPLATES,
  expandLabels,
  labelLayout,
  labelsHtml,
  sheetFits,
  templateProblem,
  textHeight,
  type LabelCodeKind,
  type LabelTemplateDraft,
  type Rect,
} from "./labels";

const base: LabelTemplateDraft = { ...PRESET_TEMPLATES[0] };
delete (base as Partial<typeof PRESET_TEMPLATES[0]>).id;

const tpl = (over: Partial<LabelTemplateDraft>): LabelTemplateDraft => ({ ...base, ...over });

const inside = (r: Rect, w: number, h: number, m: number) =>
  r.x >= m - 0.001 && r.y >= m - 0.001 && r.x + r.w <= w - m + 0.001 && r.y + r.h <= h - m + 0.001;
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w - 0.001 && a.x + a.w > b.x + 0.001 && a.y < b.y + b.h - 0.001 && a.y + a.h > b.y + 0.001;

const SIZES: [number, number][] = [
  [25, 15], [38, 25], [50, 25], [50, 30], [57, 32], [62, 29], [66.7, 25.4], [70, 37], [100, 50], [100, 100], [40, 60], [30, 80], [150, 100],
];
const KINDS: LabelCodeKind[] = ["barcode", "qr", "none"];

describe("labelLayout", () => {
  for (const [w, h] of SIZES) {
    for (const code_kind of KINDS) {
      for (const show_header of [false, true]) {
        it(`${w}×${h} ${code_kind}${show_header ? " con encabezado" : ""}: dentro del margen y sin encimarse`, () => {
          const t = tpl({ width_mm: w, height_mm: h, code_kind, show_header, show_sku: true, show_price_local: true });
          const l = labelLayout(t);
          const rects = [l.header, l.code, l.text].filter(Boolean) as Rect[];
          for (const r of rects) expect(inside(r, l.width, l.height, l.margin)).toBe(true);
          for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i], rects[j])).toBe(false);
          if (code_kind !== "none") expect(l.code).not.toBeNull();
          if (code_kind === "qr" && l.code) expect(Math.abs(l.code.w - l.code.h)).toBeLessThan(0.001);
        });
      }
    }
  }

  it("el texto cabe en su caja con los tamaños calculados (etiquetas medianas)", () => {
    for (const [w, h] of [[50, 25], [62, 29], [70, 37], [100, 50], [100, 100]] as const) {
      for (const code_kind of KINDS) {
        const t = tpl({ width_mm: w, height_mm: h, code_kind });
        const l = labelLayout(t);
        expect(l.text).not.toBeNull();
        expect(textHeight(t, l)).toBeLessThanOrEqual(l.text!.h + 0.01);
        expect(l.fonts.name).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("sin texto, el código ocupa toda la etiqueta", () => {
    const l = labelLayout(tpl({ show_name: false, show_detail: false, show_price: false, code_kind: "qr", width_mm: 30, height_mm: 30 }));
    expect(l.text).toBeNull();
    expect(l.code!.w).toBeGreaterThan(20);
  });

  it("QR a un lado en etiquetas anchas y arriba en las altas", () => {
    const wide = labelLayout(tpl({ code_kind: "qr", width_mm: 60, height_mm: 30 }));
    expect(wide.text!.x).toBeGreaterThan(wide.code!.x + wide.code!.w);
    const tall = labelLayout(tpl({ code_kind: "qr", width_mm: 40, height_mm: 60 }));
    expect(tall.text!.y).toBeGreaterThan(tall.code!.y + tall.code!.h);
  });
});

describe("plantillas", () => {
  it("valida tamaño, hoja y que lleve algo", () => {
    expect(templateProblem(tpl({}))).toBeNull();
    expect(templateProblem(tpl({ name: " " }))).toBe("Ponle un nombre a la plantilla");
    expect(templateProblem(tpl({ width_mm: 5 }))).toBe("El ancho va de 15 a 200 mm");
    expect(templateProblem(tpl({ code_kind: "none", show_name: false, show_detail: false, show_price: false }))).toMatch(/un código o algún texto/);
    expect(templateProblem(tpl({ media: "sheet", columns: 4, rows: 10, width_mm: 66.7, height_mm: 25.4 }))).toMatch(/no caben en la hoja Carta/);
  });
  it("la hoja carta de fábrica cabe", () => {
    expect(sheetFits(PRESET_TEMPLATES[1])).toBe(true);
    expect(sheetFits({ ...PRESET_TEMPLATES[1], rows: 11 })).toBe(false);
  });
});

describe("documento", () => {
  const item = { name: "Filtro <Toyota>", detail: "Corolla", sku: "F-1", code: "759001", price: "$ 9,00", priceLocal: "Bs. 7.920,00", codeSvg: "<svg></svg>" };
  const header = { text: "Mi Negocio", taxId: "J-123" };

  it("repite cada producto según las copias, con tope", () => {
    expect(expandLabels([{ item: "a", copies: 2 }, { item: "b", copies: 0 }, { item: "c", copies: 1.7 }])).toEqual(["a", "a", "c"]);
    expect(expandLabels([{ item: "a", copies: 10 }], 3)).toHaveLength(3);
  });

  it("rollo: una por página del tamaño de la etiqueta; escapa el texto", () => {
    const html = labelsHtml([item], tpl({ show_price_local: true, show_header: true, show_tax_id: true }), header);
    expect(html).toContain("size: 50mm 25mm");
    expect(html).toContain("Filtro &lt;Toyota&gt;");
    expect(html).toContain("<svg></svg>");
    expect(html).toContain("Bs. 7.920,00");
    expect(html).toContain("RIF J-123");
  });

  it("hoja: reparte en páginas de filas × columnas", () => {
    const sheet = PRESET_TEMPLATES[1];
    const html = labelsHtml(Array.from({ length: 31 }, () => item), sheet, header);
    expect(html).toContain("size: letter");
    expect(html.match(/class="sheet"/g)).toHaveLength(2);
  });

  it("por unidad: el código de la pieza se ve con QR", () => {
    const html = labelsHtml([{ ...item, code: "TEL-00007", unitCode: "TEL-00007" }], tpl({ code_kind: "qr" }), header);
    expect(html).toContain('class="ln sk uc"');
    expect(html).toContain("TEL-00007");
    const bc = labelsHtml([{ ...item, code: "TEL-00007", unitCode: "TEL-00007" }], tpl({ code_kind: "barcode" }), header);
    expect(bc).not.toContain('class="ln sk uc"');
  });

  it("sin precio ni código, no los imprime", () => {
    const html = labelsHtml([item], tpl({ show_price: false, code_kind: "none" }), header);
    expect(html).not.toContain("$ 9,00");
    expect(html).not.toContain("<svg>");
  });
});
