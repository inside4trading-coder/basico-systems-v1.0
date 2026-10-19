/**
 * Vista previa de importación: interpreta cada fila con el mapeo de
 * columnas, decide Crear / Actualizar / Bloqueada y arma lo que se manda a
 * catalog_import. Portado de buildInventoryPreview
 * (src/lib/sublimeInventoryImportExport.ts, basicosystems@f551478b) y
 * generalizado: columnas configurables, opciones libres, códigos y campos
 * propios. Las reglas de emparejamiento son las mismas que en el servidor.
 */
import { splitField, type ColumnMapping, type TargetField } from "./fields";

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
  /** Claves de campos propios y si aceptan varios valores. */
  attributes: { key: string; multi: boolean }[];
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
  rowNumber: number;
  label: string;
  action: ImportAction;
  errors: string[];
  warnings: string[];
  payload: ImportPayloadRow;
}

export interface PreviewSummary {
  total: number;
  valid: number;
  blocked: number;
  withWarnings: number;
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

export function buildPreview(rawRows: RawRow[], mapping: ColumnMapping, ctx: ImportContext, firstDataRow = 2) {
  const bySku = new Map<string, CatalogIndexEntry>();
  const byCode = new Map<string, CatalogIndexEntry>();
  for (const entry of ctx.catalog) {
    if (entry.sku) bySku.set(key(entry.sku), entry);
    for (const c of entry.codes) byCode.set(`${c.kind}|${key(c.code)}`, entry);
  }
  const locations = new Set(ctx.locationCodes.map(key));
  const attributes = new Map(ctx.attributes.map((a) => [a.key, a]));
  const columns = Object.entries(mapping).filter(([, field]) => field !== "") as [string, TargetField][];
  const hasOptions = columns.some(([, f]) => f.startsWith("option:"));

  // Pasada 1: valores por fila.
  const parsed = rawRows.map((raw, index) => {
    const rowNumber = index + firstDataRow;
    const errors: string[] = [];
    const warnings: string[] = [];
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
          else variant[kind] = n;
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
    if (hasOptions && Object.keys(options).length > 0) variant.options = options;

    // Emparejamiento, igual que el servidor: con SKU solo por SKU; sin SKU, por código.
    let existing: CatalogIndexEntry | undefined;
    if (sku) existing = bySku.get(key(sku));
    else existing = codes.map((c) => byCode.get(`${c.kind}|${key(c.code)}`)).find(Boolean);

    if (!sku && codes.length === 0) errors.push("Falta SKU o un código para identificar el producto");
    if (!existing && !product.name) errors.push("Falta el nombre para crear el producto");
    for (const c of codes) {
      const owner = byCode.get(`${c.kind}|${key(c.code)}`);
      if (owner && owner.variantId !== existing?.variantId) errors.push(`El código ${c.code} ya es de otro producto (${owner.sku ?? "sin SKU"})`);
    }

    const regular = variant.regular_price as number | undefined;
    const offer = variant.price as number | undefined;
    if (regular != null && offer != null && offer > regular) warnings.push("La oferta es mayor que el precio");
    if (!existing && regular == null && offer == null) warnings.push("Producto nuevo sin precio: no se podrá vender hasta ponérselo");
    for (const s of stock) {
      const current = existing?.stockByLocationCode[s.location_code] ?? 0;
      if (existing && current > 0 && Math.abs(s.qty - current) / current >= 0.5) {
        warnings.push(`La existencia en ${s.location_code} cambia mucho (${current} → ${s.qty})`);
      }
    }

    productKey = (productKey || String(product.name ?? "")).toLocaleLowerCase("es").trim();
    const label = [product.name, sku ?? codes[0]?.code, Object.values(options).join(" · ")].filter(Boolean).join(" — ") || `Fila ${rowNumber}`;

    return {
      rowNumber,
      label,
      errors,
      warnings,
      existing,
      payload: { row_number: rowNumber, product_key: productKey, sku, product, variant, codes, attributes: attrs, stock } as ImportPayloadRow,
    };
  });

  // Pasada 2: conflictos dentro del archivo.
  const skuRows = new Map<string, number[]>();
  const codeOwners = new Map<string, string>();
  const groupOptions = new Map<string, Map<string, number>>();
  for (const p of parsed) {
    const identity = p.payload.sku ? `sku|${key(p.payload.sku)}` : `row|${p.rowNumber}`;
    if (p.payload.sku) skuRows.set(key(p.payload.sku), [...(skuRows.get(key(p.payload.sku)) ?? []), p.rowNumber]);
    for (const c of p.payload.codes) {
      const k = `${c.kind}|${key(c.code)}`;
      const owner = codeOwners.get(k);
      if (owner && owner !== identity) p.errors.push(`El código ${c.code} se repite con otro producto en el archivo`);
      else codeOwners.set(k, identity);
    }
    if (!p.existing) {
      const opts = JSON.stringify(p.payload.variant.options ?? {});
      const g = groupOptions.get(p.payload.product_key) ?? new Map<string, number>();
      const seen = g.get(opts);
      if (seen != null) {
        p.errors.push(
          opts === "{}"
            ? `Varias filas con la misma clave de producto (fila ${seen}) necesitan opciones distintas, p. ej. Talla`
            : `Repite las mismas opciones que la fila ${seen}`,
        );
      } else g.set(opts, p.rowNumber);
      groupOptions.set(p.payload.product_key, g);
    }
  }
  for (const [, rowsWithSku] of skuRows) {
    if (rowsWithSku.length < 2) continue;
    for (const p of parsed) {
      if (rowsWithSku.includes(p.rowNumber)) p.errors.push(`SKU repetido en las filas ${rowsWithSku.join(", ")}`);
    }
  }

  const preview: PreviewRow[] = parsed.map((p) => ({
    rowNumber: p.rowNumber,
    label: p.label,
    action: p.errors.length ? "Bloqueada" : p.existing ? "Actualizar" : "Crear",
    errors: p.errors,
    warnings: p.warnings,
    payload: p.payload,
  }));

  const newGroups = new Set(preview.filter((r) => r.action === "Crear").map((r) => r.payload.product_key));
  const summary: PreviewSummary = {
    total: preview.length,
    valid: preview.filter((r) => r.action !== "Bloqueada").length,
    blocked: preview.filter((r) => r.action === "Bloqueada").length,
    withWarnings: preview.filter((r) => r.warnings.length > 0).length,
    productsCreate: newGroups.size,
    variantsCreate: preview.filter((r) => r.action === "Crear").length,
    variantsUpdate: preview.filter((r) => r.action === "Actualizar").length,
    stockRows: preview.filter((r) => r.action !== "Bloqueada").reduce((a, r) => a + r.payload.stock.length, 0),
  };
  return { preview, summary };
}
