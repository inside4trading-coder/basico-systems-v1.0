/**
 * Vista previa de importación: interpreta cada fila con el mapeo de
 * columnas y las reglas de su hoja, decide Crear / Actualizar / Bloqueada y
 * arma lo que se manda a catalog_import. Portado de buildInventoryPreview
 * (src/lib/sublimeInventoryImportExport.ts, basicosystems@f551478b) y
 * generalizado: varias hojas, columnas configurables, opciones libres,
 * códigos, campos propios y reglas. Las reglas de emparejamiento son las
 * mismas que en el servidor.
 */
import { splitField, type ColumnMapping, type TargetField } from "./fields";
import { netFromGross, NO_RULES, skuGenerator, type ImportRules } from "./rules";

export type RawRow = Record<string, string>;

export interface CatalogIndexEntry {
  variantId: string;
  productId: string;
  sku: string | null;
  codes: { kind: string; code: string }[];
  stockByLocationCode: Record<string, number>;
}

export interface ImportContext {
  catalog: CatalogIndexEntry[];
  /** Códigos de sede activos, en mayúsculas. */
  locationCodes: string[];
  /** Claves de campos propios (existentes o por crear) y si aceptan varios valores. */
  attributes: { key: string; multi: boolean }[];
  /** IVA por defecto del negocio, en %, para la regla «el precio incluye IVA». */
  taxRate?: number;
}

export interface SheetSource {
  name: string;
  rows: RawRow[];
  /** Fila del archivo de cada registro; si falta, se cuentan desde firstDataRow. */
  rowNumbers?: number[];
  firstDataRow?: number;
  mapping: ColumnMapping;
  rules?: ImportRules;
}

export interface ImportPayloadRow {
  row_number: number;
  product_key: string;
  sku: string | null;
  product: Record<string, string | boolean>;
  variant: Record<string, string | number | boolean | Record<string, string>>;
  codes: { kind: string; code: string }[];
  attributes: { key: string; value: string }[];
  stock: { location_code: string; qty: number }[];
}

export type ImportAction = "Crear" | "Actualizar" | "Bloqueada";

export interface PreviewRow {
  /** Hoja de origen ("" si es una sola). */
  sheet: string;
  /** Fila en el archivo. */
  rowNumber: number;
  label: string;
  action: ImportAction;
  errors: string[];
  warnings: string[];
  /** Información sin problema (p. ej. el SKU generado). */
  notes: string[];
  payload: ImportPayloadRow;
}

export interface PreviewSummary {
  total: number;
  valid: number;
  blocked: number;
  withWarnings: number;
  skipped: number;
  generatedSkus: number;
  productsCreate: number;
  variantsCreate: number;
  variantsUpdate: number;
  stockRows: number;
}

const clean = (v: unknown) => String(v ?? "").trim();
const key = (v: unknown) => clean(v).toLocaleUpperCase("es");

/**
 * Número escrito a la venezolana o a la inglesa: "1.234,56", "1,234.56",
 * "12,5", "$ 30", "Bs. 1.500". Devuelve null si está vacío y NaN si no es número.
 */
export function parseAmount(value: string): number | null {
  let t = clean(value).replace(/\s/g, "").replace(/^(bs\.?|usd|us\$|\$|ref\.?)/i, "").replace(/(bs\.?|usd|\$)$/i, "");
  if (!t) return null;
  const lastComma = t.lastIndexOf(",");
  const lastDot = t.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // El último separador es el decimal.
    t = lastComma > lastDot ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (lastComma >= 0) {
    t = /^-?\d{1,3}(,\d{3})+$/.test(t) && t.split(",").length > 2 ? t.replace(/,/g, "") : t.replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) {
    // "1.500" o "12.345.678": puntos de miles.
    t = t.replace(/\./g, "");
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

export function parseYesNo(value: string): boolean | null | "invalid" {
  const v = clean(value).toLowerCase();
  if (!v) return null;
  if (["si", "sí", "s", "true", "1", "x", "activo", "yes"].includes(v)) return true;
  if (["no", "n", "false", "0", "inactivo"].includes(v)) return false;
  return "invalid";
}

/** Una sola hoja, sin reglas (el comportamiento estricto). */
export function buildPreview(rawRows: RawRow[], mapping: ColumnMapping, ctx: ImportContext, firstDataRow = 2) {
  return buildSheetsPreview([{ name: "", rows: rawRows, firstDataRow, mapping, rules: NO_RULES }], ctx);
}

interface ParsedRow {
  sheet: string;
  rowNumber: number;
  rules: ImportRules;
  hasOptions: boolean;
  errors: string[];
  warnings: string[];
  notes: string[];
  productKey: string;
  sku: string | null;
  product: ImportPayloadRow["product"];
  variant: ImportPayloadRow["variant"];
  options: Record<string, string>;
  codes: ImportPayloadRow["codes"];
  attrs: ImportPayloadRow["attributes"];
  stock: ImportPayloadRow["stock"];
  existing?: CatalogIndexEntry;
}

export function buildSheetsPreview(sources: SheetSource[], ctx: ImportContext) {
  const bySku = new Map<string, CatalogIndexEntry>();
  const byCode = new Map<string, CatalogIndexEntry>();
  for (const entry of ctx.catalog) {
    if (entry.sku) bySku.set(key(entry.sku), entry);
    for (const c of entry.codes) byCode.set(`${c.kind}|${key(c.code)}`, entry);
  }
  const locations = new Set(ctx.locationCodes.map(key));
  const attributes = new Map(ctx.attributes.map((a) => [a.key, a]));
  const findExisting = (sku: string | null, codes: ImportPayloadRow["codes"]) =>
    sku ? bySku.get(key(sku)) : codes.map((c) => byCode.get(`${c.kind}|${key(c.code)}`)).find(Boolean);

  // Pasada 1: valores por fila.
  let skipped = 0;
  const parsed: ParsedRow[] = [];
  for (const source of sources) {
    const rules = source.rules ?? NO_RULES;
    const columns = Object.entries(source.mapping).filter(([, field]) => field !== "") as [string, TargetField][];
    const hasOptions = columns.some(([, f]) => f.startsWith("option:"));
    source.rows.forEach((raw, index) => {
      const row = parseRow(raw, columns, rules, locations, attributes, ctx.taxRate ?? 0);
      if (!row.product.name && rules.skipNoName && !findExisting(row.sku, row.codes)) {
        skipped += 1;
        return;
      }
      parsed.push({
        ...row,
        sheet: source.name,
        rowNumber: source.rowNumbers?.[index] ?? index + (source.firstDataRow ?? 2),
        rules,
        hasOptions,
      });
    });
  }

  // SKU automático: un código que se repite en el archivo no sirve de SKU para
  // ninguna de sus filas (todas reciben uno nuevo y la búsqueda por el código
  // las muestra juntas). Las filas sin SKU que no son de un producto existente también.
  const nextSku = skuGenerator(sources.find((s) => s.rules?.autoSku)?.rules?.skuPrefix ?? "P-", [
    ...bySku.keys(),
    ...parsed.flatMap((p) => (p.sku ? [p.sku] : [])),
  ]);
  const skuCount = new Map<string, number>();
  for (const p of parsed) if (p.sku) skuCount.set(key(p.sku), (skuCount.get(key(p.sku)) ?? 0) + 1);
  let generatedSkus = 0;
  for (const p of parsed) {
    const original = p.sku;
    if (original && p.rules.keepCodeAs) p.attrs.push({ key: p.rules.keepCodeAs, value: original });
    if (!p.rules.autoSku) continue;
    const repeated = Boolean(original) && (skuCount.get(key(original)) ?? 0) > 1;
    const missing = !original && !findExisting(null, p.codes);
    if (repeated || missing) {
      p.sku = nextSku();
      generatedSkus += 1;
      p.notes.push(repeated ? `SKU ${p.sku} (el código ${original} se repite)` : `SKU ${p.sku} generado`);
    }
  }

  parsed.forEach((p, i) => {
    p.existing = findExisting(p.sku, p.codes);
    if (!p.sku && p.codes.length === 0) p.errors.push("Falta SKU o un código para identificar el producto");
    if (!p.existing && !p.product.name) p.errors.push("Falta el nombre para crear el producto");
    for (const c of p.codes) {
      const owner = byCode.get(`${c.kind}|${key(c.code)}`);
      if (owner && owner.variantId !== p.existing?.variantId) p.errors.push(`El código ${c.code} ya es de otro producto (${owner.sku ?? "sin SKU"})`);
    }
    if (!p.existing) {
      const d = p.rules.defaults;
      if (d.brand && !p.product.brand) p.product.brand = d.brand;
      if (d.category && !p.product.category) p.product.category = d.category;
      if (d.unit && !p.variant.unit) p.variant.unit = d.unit;
    }

    const regular = p.variant.regular_price as number | undefined;
    const offer = p.variant.price as number | undefined;
    if (regular != null && offer != null && offer > regular) p.warnings.push("La oferta es mayor que el precio");
    if (!p.existing && regular == null && offer == null) p.warnings.push("Producto nuevo sin precio: no se podrá vender hasta ponérselo");
    for (const s of p.stock) {
      const current = p.existing?.stockByLocationCode[s.location_code] ?? 0;
      if (p.existing && current > 0 && Math.abs(s.qty - current) / current >= 0.5) {
        p.warnings.push(`La existencia en ${s.location_code} cambia mucho (${current} → ${s.qty})`);
      }
    }
    // Sin columnas de opción, cada fila es su propio producto aunque se repita el nombre.
    const name = String(p.product.name ?? "");
    p.productKey = (p.productKey || (p.hasOptions ? name : `${name}#${i + 1}`)).toLocaleLowerCase("es").trim();
  });

  // Pasada 2: conflictos dentro del archivo.
  const skuRows = new Map<string, ParsedRow[]>();
  const codeOwners = new Map<string, string>();
  const groupOptions = new Map<string, Map<string, number>>();
  parsed.forEach((p, i) => {
    const identity = p.sku ? `sku|${key(p.sku)}` : `row|${i}`;
    if (p.sku) skuRows.set(key(p.sku), [...(skuRows.get(key(p.sku)) ?? []), p]);
    for (const c of p.codes) {
      const k = `${c.kind}|${key(c.code)}`;
      const owner = codeOwners.get(k);
      if (owner && owner !== identity) p.errors.push(`El código ${c.code} se repite con otro producto en el archivo`);
      else codeOwners.set(k, identity);
    }
    if (!p.existing) {
      const opts = JSON.stringify(p.hasOptions && Object.keys(p.options).length ? p.options : {});
      const g = groupOptions.get(p.productKey) ?? new Map<string, number>();
      const seen = g.get(opts);
      if (seen != null) {
        p.errors.push(
          opts === "{}"
            ? `Varias filas con la misma clave de producto (fila ${seen}) necesitan opciones distintas, p. ej. Talla`
            : `Repite las mismas opciones que la fila ${seen}`,
        );
      } else g.set(opts, p.rowNumber);
      groupOptions.set(p.productKey, g);
    }
  });
  const multiSheet = new Set(parsed.map((p) => p.sheet)).size > 1;
  const where = (p: ParsedRow) => (multiSheet ? `${p.sheet} ${p.rowNumber}` : String(p.rowNumber));
  for (const [, rows] of skuRows) {
    if (rows.length < 2) continue;
    for (const p of rows) p.errors.push(`SKU repetido en las filas ${rows.map(where).join(", ")}`);
  }

  const preview: PreviewRow[] = parsed.map((p, i) => {
    const variant = { ...p.variant };
    if (p.hasOptions && Object.keys(p.options).length > 0) variant.options = p.options;
    return {
      sheet: p.sheet,
      rowNumber: p.rowNumber,
      label: [p.product.name, p.sku ?? p.codes[0]?.code, Object.values(p.options).join(" · ")].filter(Boolean).join(" — ") || `Fila ${p.rowNumber}`,
      action: p.errors.length ? "Bloqueada" : p.existing ? "Actualizar" : "Crear",
      errors: p.errors,
      warnings: p.warnings,
      notes: p.notes,
      payload: {
        row_number: i + 1,
        product_key: p.productKey,
        sku: p.sku,
        product: p.product,
        variant,
        codes: p.codes,
        attributes: p.attrs,
        stock: p.stock,
      },
    };
  });

  const newGroups = new Set(preview.filter((r) => r.action === "Crear").map((r) => r.payload.product_key));
  const summary: PreviewSummary = {
    total: preview.length,
    valid: preview.filter((r) => r.action !== "Bloqueada").length,
    blocked: preview.filter((r) => r.action === "Bloqueada").length,
    withWarnings: preview.filter((r) => r.warnings.length > 0).length,
    skipped,
    generatedSkus,
    productsCreate: newGroups.size,
    variantsCreate: preview.filter((r) => r.action === "Crear").length,
    variantsUpdate: preview.filter((r) => r.action === "Actualizar").length,
    stockRows: preview.filter((r) => r.action !== "Bloqueada").reduce((a, r) => a + r.payload.stock.length, 0),
  };
  return { preview, summary };
}

function parseRow(
  raw: RawRow,
  columns: [string, TargetField][],
  rules: ImportRules,
  locations: Set<string>,
  attributes: Map<string, { key: string; multi: boolean }>,
  taxRate: number,
) {
  const errors: string[] = [];
  const product: ImportPayloadRow["product"] = {};
  const variant: ImportPayloadRow["variant"] = {};
  const options: Record<string, string> = {};
  const codes: ImportPayloadRow["codes"] = [];
  const attrs: ImportPayloadRow["attributes"] = [];
  const stock: ImportPayloadRow["stock"] = [];
  let sku: string | null = null;
  let productKey = "";

  for (const [column, field] of columns) {
    const value = clean(raw[column]);
    if (!value) continue;
    const [kind, rest] = splitField(field);
    switch (kind) {
      case "product_key":
        productKey = value;
        break;
      case "name":
      case "brand":
      case "category":
      case "description":
        product[kind] = value;
        break;
      case "sku":
        sku = value;
        break;
      case "unit":
        variant.unit = value;
        break;
      case "regular_price":
      case "price":
      case "cost": {
        const n = parseAmount(value);
        if (n == null) break;
        if (Number.isNaN(n) || n < 0) errors.push(`"${column}" no es un monto válido: ${value}`);
        else variant[kind] = kind !== "cost" && rules.pricesIncludeTax ? netFromGross(n, taxRate) : n;
        break;
      }
      case "active": {
        const b = parseYesNo(value);
        if (b === "invalid") errors.push(`"${column}" debe ser Sí o No`);
        else if (b !== null) {
          product.is_active = b;
          variant.is_active = b;
        }
        break;
      }
      case "option":
        options[rest] = value;
        break;
      case "code":
        codes.push({ kind: rest, code: value });
        break;
      case "attr": {
        const def = attributes.get(rest);
        if (!def) {
          errors.push(`El campo ${rest} no existe en el catálogo`);
          break;
        }
        const values = def.multi ? value.split(/[;|]/).map((v) => v.trim()).filter(Boolean) : [value];
        for (const v of values) attrs.push({ key: rest, value: v });
        break;
      }
      case "stock": {
        const n = parseAmount(value);
        if (n == null) break;
        if (Number.isNaN(n) || n < 0) errors.push(`"${column}" no es una existencia válida: ${value}`);
        else if (!locations.has(key(rest))) errors.push(`La sede ${rest} no existe o está inactiva`);
        else stock.push({ location_code: key(rest), qty: n });
        break;
      }
    }
  }
  return { errors, warnings: [] as string[], notes: [] as string[], product, variant, options, codes, attrs, stock, sku, productKey };
}

/** «El código 123 se repite…» y «El código 456 se repite…» cuentan como la misma causa. */
export function issueKind(message: string): string {
  // «"Cantidad" no es una existencia válida: O» → sin el valor del final.
  const base = message.includes('"') ? message.replace(/:[^:]*$/, "") : message;
  return base
    .replace(/\([^)]*\)/g, "")
    .replace(/"([^"]*)"/g, "«$1»")
    .replace(/\b[\w./-]*\d[\w./-]*\b/g, "…")
    .replace(/\s+/g, " ")
    .trim();
}

export function groupIssues(rows: PreviewRow[]): { kind: string; count: number; blocking: boolean }[] {
  const groups = new Map<string, { kind: string; count: number; blocking: boolean }>();
  for (const r of rows) {
    for (const [list, blocking] of [
      [r.errors, true],
      [r.warnings, false],
    ] as const) {
      for (const kind of new Set(list.map(issueKind))) {
        const g = groups.get(kind) ?? { kind, count: 0, blocking };
        g.count += 1;
        groups.set(kind, g);
      }
    }
  }
  return Array.from(groups.values()).sort((a, b) => Number(b.blocking) - Number(a.blocking) || b.count - a.count);
}
