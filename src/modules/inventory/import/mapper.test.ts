import { describe, expect, it } from "vitest";
import { matchHeader } from "./fields";
import { cellToString, detectHeaderRow, tableToSheet, trimTable } from "./files";
import { normalizedTable } from "./normalized";
import { buildSheetsPreview, groupIssues, type ImportContext } from "./preview";
import { DEFAULT_RULES, netFromGross, skuGenerator } from "./rules";
import { effectiveRules, initSheet, moveStockTo, pendingAttributes, prettyLabel, stockColumn } from "./sheetState";
import { findFormat, readTemplate, toTemplate } from "./templates";

// Réplica sintética de un Excel real: una fila de tasas arriba, el código se
// repite entre marcas, dos columnas calculadas con un número como título.
const RAW = [
  [null, null, null, null, null, "BCV", "Bs.", null, null, null, null, null],
  ["CODIGO", "DESCRIPCION DEL ARTICULO", "PROV.", "MARCA", "CANTIDAD", 300.5, 400, "PRECIO USD", "PESO", "UBICACIÓN", null, null],
  ["A-100", "BOMBA DE AGUA MODELO X", null, "MARCA UNO", 2, 39.93, 12000, 30, "1kg", "ESTANTE 1", null, null],
  ["A-100", "BOMBA DE AGUA MODELO X", null, "MARCA DOS", 1, 33.28, 10000, 25, null, "ESTANTE 1", null, null],
  [null, "FUSIBLE 10 AMPERIOS", "DISTRIBUIDORA", null, 23, 1.33, 400, 1, null, "ESTANTE 2", null, null],
  [null, null, null, null, null, null, null, null, null, null, null, null],
  ["B-200", null, null, "MARCA UNO", 1, null, null, null, null, null, null, null],
  ["C-300", "CORREA 4.0", null, "MARCA TRES", 0, 15.97, 4800, 12.345, null, "ESTANTE 3", null, null],
];

const mctx = { locationCodes: ["T1"], defaultLocationCode: "T1", attributes: [] };
const pctx: ImportContext = { catalog: [], locationCodes: ["T1"], attributes: [], taxRate: 16 };

function sheetSources(rules = DEFAULT_RULES) {
  const s = initSheet({ name: "INVENTARIO", table: trimTable(RAW) }, mctx);
  const sheet = { ...s, rules };
  const pending = pendingAttributes([sheet], []);
  return {
    sheet,
    pending,
    ctx: { ...pctx, attributes: pending.map((p) => ({ key: p.key, multi: false })) },
    source: { name: sheet.name, rows: sheet.parsed.rows, rowNumbers: sheet.parsed.rowNumbers, mapping: sheet.mapping, rules: effectiveRules(sheet) },
  };
}

describe("lectura de la hoja", () => {
  it("escribe decimales con coma para no confundirlos con miles", () => {
    expect(cellToString(12.345)).toBe("12,345");
    expect(cellToString(1500)).toBe("1500");
    expect(cellToString(null)).toBe("");
  });

  it("quita columnas y filas vacías del final", () => {
    const t = trimTable(RAW);
    expect(t[0]).toHaveLength(10);
    expect(t).toHaveLength(8);
  });

  it("encuentra la fila de títulos aunque arriba haya una fila de tasas", () => {
    expect(detectHeaderRow(trimTable(RAW))).toBe(1);
  });

  it("nombra las columnas sin título o con un número, y guarda la fila de cada registro", () => {
    const sheet = tableToSheet(RAW);
    expect(sheet.headers).toContain("Columna F (300,5)");
    expect(sheet.rows).toHaveLength(5);
    expect(sheet.rowNumbers).toEqual([3, 4, 5, 7, 8]);
  });
});

describe("cruce sugerido", () => {
  it.each([
    ["DESCRIPCION DEL ARTICULO", "description"],
    ["Cant.", "stock"],
    ["CANTIDAD", "stock"],
    ["PRECIO USD", "regular_price"],
    ["Código de barras", "code:barcode"],
    ["PESO", null],
    ["UBICACIÓN", null],
  ])("%s → %s", (header, field) => {
    expect(matchHeader(header)).toBe(field);
  });

  it("el código sigue siendo SKU aunque ya exista el campo propio «Codigo»", () => {
    const s = initSheet({ name: "INVENTARIO", table: trimTable(RAW) }, { ...mctx, attributes: [{ key: "codigo", label: "Codigo" }] });
    expect(s.mapping.CODIGO).toBe("sku");
  });

  it("propone nombre, código, precio, existencia y marca para el Excel de ejemplo", () => {
    const { sheet } = sheetSources();
    expect(sheet.mapping).toMatchObject({
      CODIGO: "sku",
      "DESCRIPCION DEL ARTICULO": "name",
      MARCA: "brand",
      CANTIDAD: "stock:T1",
      "PRECIO USD": "regular_price",
      PESO: "",
    });
  });
});

describe("reglas", () => {
  it("quita el IVA de un precio que lo incluye", () => {
    expect(netFromGross(116, 16)).toBe(100);
    expect(netFromGross(15, 16)).toBe(12.93);
  });

  it("genera SKU consecutivos sin chocar con los que ya existen", () => {
    const next = skuGenerator("P-", ["P-00007", "p-00009", "X-1"]);
    expect([next(), next()]).toEqual(["P-00010", "P-00011"]);
  });

  it("con las reglas por defecto el Excel de ejemplo no tiene filas bloqueadas", () => {
    const { source, ctx, pending } = sheetSources();
    const { preview, summary } = buildSheetsPreview([source], ctx);
    expect(pending).toEqual([{ key: "codigo", label: "Codigo" }]);
    expect(summary).toMatchObject({ total: 4, blocked: 0, skipped: 1, generatedSkus: 3, productsCreate: 4 });
    // A-100 se repite: las dos filas reciben SKU propio y guardan el código original.
    expect(preview.slice(0, 2).map((r) => r.payload.sku)).toEqual(["P-00001", "P-00002"]);
    expect(preview[1].payload.attributes).toEqual([{ key: "codigo", value: "A-100" }]);
    expect(preview[1].notes[0]).toContain("se repite");
    // Sin código: SKU generado; un código que no se repite se queda. Fila 7 (sin nombre) se salta.
    expect(preview[2].payload.sku).toBe("P-00003");
    expect(preview[3].payload.sku).toBe("C-300");
    expect(preview.map((r) => r.rowNumber)).toEqual([3, 4, 5, 8]);
    // Mismo nombre, productos distintos.
    expect(new Set(preview.map((r) => r.payload.product_key)).size).toBe(4);
    expect(preview[3].payload.variant.regular_price).toBe(12.345);
  });

  it("sin reglas, el mismo Excel queda bloqueado como antes", () => {
    const { source, ctx } = sheetSources({ ...DEFAULT_RULES, autoSku: false, skipNoName: false });
    const { summary } = buildSheetsPreview([source], ctx);
    expect(summary.blocked).toBe(4);
  });

  it("precio con IVA y valores por defecto solo en productos nuevos", () => {
    const { source, ctx } = sheetSources({ ...DEFAULT_RULES, pricesIncludeTax: true, defaults: { category: "General" } });
    const { preview } = buildSheetsPreview([source], ctx);
    expect(preview[0].payload.variant.regular_price).toBe(25.86);
    expect(preview[0].payload.product.category).toBe("General");
  });

  it("dos hojas: SKU únicos entre ambas y mensajes con la hoja", () => {
    const { source, ctx } = sheetSources();
    const { preview, summary } = buildSheetsPreview([source, { ...source, name: "OTRA" }], ctx);
    expect(summary.blocked).toBe(0);
    expect(new Set(preview.map((r) => r.payload.sku)).size).toBe(preview.length);
    expect(preview.map((r) => r.payload.row_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("agrupa los problemas por causa", () => {
    const { source, ctx } = sheetSources({ ...DEFAULT_RULES, autoSku: false });
    const groups = groupIssues(buildSheetsPreview([source], ctx).preview);
    expect(groups[0]).toMatchObject({ blocking: true });
    expect(groups.find((g) => g.kind.startsWith("SKU repetido"))?.count).toBe(2);
  });
});

describe("formatos guardados", () => {
  it("lee el formato plano de antes", () => {
    const t = readTemplate({ Nombre: "name", SKU: "sku" });
    expect(t.sheets[0].columns).toEqual({ Nombre: "name", SKU: "sku" });
    expect(t.sheets[0].rules).toEqual(DEFAULT_RULES);
  });

  it("reconoce el formato de un archivo con los mismos títulos", () => {
    const { sheet } = sheetSources();
    const template = toTemplate([
      { name: "INVENTARIO", headerRow: 2, signature: ["codigo", "descripcion del articulo", "prov", "marca", "cantidad", "columna f 300 5", "columna g 400", "precio usd", "peso", "ubicacion"], columns: { ...sheet.mapping, PESO: "attr:peso" }, rules: { ...DEFAULT_RULES, pricesIncludeTax: true } },
    ]);
    expect(template.sheets[0].columns).not.toHaveProperty("PROV.");
    const found = findFormat([{ name: "Proveedor A", mapping: template }], sheet.parsed.headers);
    expect(found?.template.name).toBe("Proveedor A");
    const applied = initSheet({ name: "INVENTARIO", table: trimTable(RAW) }, mctx, found!.format);
    expect(applied.mapping.PESO).toBe("attr:peso");
    expect(applied.rules.pricesIncludeTax).toBe(true);
    expect(findFormat([{ name: "x", mapping: template }], ["Nombre", "SKU"])).toBeNull();
  });
});

describe("archivo normalizado", () => {
  it("usa los títulos de la plantilla y agrega la revisión", () => {
    const { source, ctx, pending } = sheetSources();
    const { preview } = buildSheetsPreview([source], ctx);
    const { headers, data } = normalizedTable(preview, { attributeLabels: Object.fromEntries(pending.map((p) => [p.key, p.label])), locationCodes: ["T1"] });
    expect(headers).toEqual(["Nombre", "Marca", "Categoría", "Descripción", "SKU", "Codigo", "Precio sin IVA", "Oferta sin IVA", "Costo", "Unidad", "Existencia T1", "Fila", "Revisión"]);
    expect(data[1].slice(0, 6)).toEqual(["BOMBA DE AGUA MODELO X", "MARCA DOS", null, null, "P-00002", "A-100"]);
  });
});

describe("etiquetas", () => {
  it("pasa títulos en mayúsculas a tipo oración", () => {
    expect(prettyLabel("UBICACIÓN")).toBe("Ubicación");
    expect(prettyLabel("Peso neto")).toBe("Peso neto");
  });
});

describe("sede de la mercancía", () => {
  it("mueve la única columna de existencia a otra sede", () => {
    const mapping = { CANTIDAD: "stock:T1" as const, MARCA: "brand" as const };
    expect(stockColumn(mapping)).toEqual({ header: "CANTIDAD", location: "T1" });
    expect(moveStockTo(mapping, "AL")).toEqual({ CANTIDAD: "stock:AL", MARCA: "brand" });
    expect(stockColumn({ A: "stock:T1", B: "stock:AL" })).toBeNull();
  });
});

describe("productos ya cargados", () => {
  // Catálogo como quedó después de importar el archivo una vez.
  function catalogAfterFirstImport() {
    const { source, ctx } = sheetSources();
    const { preview } = buildSheetsPreview([source], ctx);
    return preview.map((r, i) => ({
      variantId: `v${i}`,
      productId: `p${i}`,
      sku: r.payload.sku,
      codes: [],
      stockByLocationCode: {},
      name: String(r.payload.product.name),
      brand: (r.payload.product.brand as string | undefined) ?? null,
      codeValues: r.payload.attributes.filter((a) => a.key === "codigo").map((a) => a.value),
    }));
  }

  it("volver a subir el mismo archivo no crea nada nuevo", () => {
    const catalog = catalogAfterFirstImport();
    const { source, ctx } = sheetSources();
    const { preview, summary } = buildSheetsPreview([source], { ...ctx, catalog });
    expect(summary).toMatchObject({ variantsCreate: 0, variantsUpdate: 4, generatedSkus: 0, recognized: 3, blocked: 0 });
    expect(preview.map((r) => r.payload.sku)).toEqual(catalog.map((c) => c.sku));
    expect(preview[0].notes[0]).toContain("Ya estaba cargado");
  });

  it("mismo nombre con otra marca es otro producto", () => {
    const catalog = catalogAfterFirstImport().map((c) => ({ ...c, brand: "OTRA MARCA", codeValues: [] }));
    const { source, ctx } = sheetSources();
    const { summary } = buildSheetsPreview([source], { ...ctx, catalog });
    expect(summary.recognized).toBe(0);
  });

  it("el mismo producto varias veces se empareja en orden", () => {
    const first = catalogAfterFirstImport();
    const twin = { ...first[2], variantId: "v9", productId: "p9", sku: "P-00099" };
    const { source, ctx } = sheetSources();
    const { preview } = buildSheetsPreview([source], { ...ctx, catalog: [...first, twin] });
    const fusible = preview.find((r) => r.payload.product.name === "FUSIBLE 10 AMPERIOS")!;
    expect(fusible.payload.sku).toBe("P-00003");
  });

  it("si el archivo trae más copias que el catálogo, la de más se crea con aviso", () => {
    const catalog = catalogAfterFirstImport();
    const { source, ctx } = sheetSources();
    const doubled = { ...source, rows: [...source.rows, source.rows[2]], rowNumbers: [...(source.rowNumbers ?? []), 99] };
    const { preview } = buildSheetsPreview([doubled], { ...ctx, catalog });
    const extra = preview[preview.length - 1];
    expect(extra.action).toBe("Crear");
    expect(extra.warnings[0]).toContain("Puede estar repetido");
  });
});
