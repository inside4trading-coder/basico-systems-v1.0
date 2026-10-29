/**
 * Campos internos a los que se puede asignar una columna del archivo.
 *
 * Fijos: product_key, name, brand, category, description, sku, regular_price,
 * price, cost, unit, active. Dinámicos (dependen del negocio):
 *   option:<Nombre>   opción de variante (Talla, Color, Medida…)
 *   code:<tipo>       código (barcode, oem, proveedor…)
 *   attr:<clave>      campo propio del catálogo
 *   stock:<CÓDIGO>    existencia en una sede
 */

export type FixedField =
  | "product_key"
  | "name"
  | "brand"
  | "category"
  | "description"
  | "sku"
  | "regular_price"
  | "price"
  | "cost"
  | "unit"
  | "active";

export type TargetField = FixedField | `option:${string}` | `code:${string}` | `attr:${string}` | `stock:${string}`;

/** Columna del archivo → campo interno ("" = no se importa). */
export type ColumnMapping = Record<string, TargetField | "">;

export const FIXED_FIELD_LABEL: Record<FixedField, string> = {
  product_key: "Clave de producto (agrupa variantes)",
  name: "Nombre",
  brand: "Marca",
  category: "Categoría",
  description: "Descripción",
  sku: "SKU",
  regular_price: "Precio sin IVA",
  price: "Oferta sin IVA",
  cost: "Costo",
  unit: "Unidad de venta",
  active: "Activo (Sí/No)",
};

export const CODE_KIND_LABEL: Record<string, string> = {
  barcode: "Código de barras",
  interno: "Código interno",
  proveedor: "Código de proveedor",
  oem: "Número de parte / OEM",
};

export function fieldLabel(field: TargetField, attributeLabels: Record<string, string> = {}): string {
  if (field in FIXED_FIELD_LABEL) return FIXED_FIELD_LABEL[field as FixedField];
  const [kind, rest] = splitField(field);
  if (kind === "option") return `Opción: ${rest}`;
  if (kind === "code") return CODE_KIND_LABEL[rest] ?? `Código: ${rest}`;
  if (kind === "attr") return attributeLabels[rest] ?? `Campo: ${rest}`;
  if (kind === "stock") return `Existencia en ${rest}`;
  return field;
}

export function splitField(field: string): [string, string] {
  const i = field.indexOf(":");
  return i < 0 ? [field, ""] : [field.slice(0, i), field.slice(i + 1)];
}

/** Minúsculas, sin acentos ni signos: "Código de Barras" → "codigo de barras". */
export function normalizeHeader(header: string): string {
  return header
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Sinónimos habituales en los Excels de los negocios en Venezuela. */
const HEADER_SYNONYMS: [string[], TargetField][] = [
  [["clave producto", "clave", "grupo", "modelo"], "product_key"],
  [["nombre", "nombre producto", "producto", "descripcion corta", "articulo", "item"], "name"],
  [["marca", "fabricante"], "brand"],
  [["categoria", "rubro", "departamento", "linea", "familia"], "category"],
  [["descripcion", "detalle"], "description"],
  [["sku", "codigo", "cod", "referencia", "ref", "codigo producto", "codigo articulo"], "sku"],
  [["precio sin iva", "precio", "precio venta", "precio de venta", "precio detal", "precio usd", "precio ref", "precio base", "usd", "precio dolar", "precio dolares"], "regular_price"],
  [["oferta sin iva", "oferta", "precio oferta", "precio promocion"], "price"],
  [["costo", "costo unitario", "costo usd", "costo ref"], "cost"],
  [["unidad", "unidad de venta", "um", "presentacion"], "unit"],
  [["activo", "estado"], "active"],
  [["codigo de barras", "codigo barras", "ean", "upc", "barcode"], "code:barcode"],
  [["numero de parte", "nro parte", "oem", "part number"], "code:oem"],
  [["codigo proveedor", "cod proveedor"], "code:proveedor"],
  [["talla", "size"], "option:Talla"],
  [["color"], "option:Color"],
  [["medida", "tamano"], "option:Medida"],
];

const STOCK_NAMES = ["existencia", "existencias", "stock", "cantidad", "cant", "inventario", "disponible", "unidades"];

/**
 * Campo para un encabezado. Primero el nombre exacto; si no, por la primera
 * palabra ("Descripción del repuesto" → descripción) o por abreviatura de 4+
 * letras ("Cant" → cantidad). Devuelve "stock" para la existencia genérica.
 */
export function matchHeader(header: string): TargetField | "stock" | null {
  const h = normalizeHeader(header);
  if (!h) return null;
  if (STOCK_NAMES.includes(h)) return "stock";
  const exact = HEADER_SYNONYMS.find(([names]) => names.includes(h));
  if (exact) return exact[1];
  const first = h.split(" ")[0];
  if (STOCK_NAMES.includes(first)) return "stock";
  const byWord = HEADER_SYNONYMS.find(([names]) => names.includes(first));
  if (byWord) return byWord[1];
  if (first.length >= 4) {
    if (STOCK_NAMES.some((n) => n.startsWith(first))) return "stock";
    const byPrefix = HEADER_SYNONYMS.find(([names]) => names.some((n) => !n.includes(" ") && n.startsWith(first)));
    if (byPrefix) return byPrefix[1];
  }
  return null;
}

/** 1 si el texto parece un título de columna conocido, 0 si no (para hallar la fila de encabezado). */
export function headerScore(cell: string): number {
  return matchHeader(cell) ? 1 : 0;
}

/**
 * Propone un mapeo por nombre de columna. "existencia"/"stock" va a la sede
 * por defecto; una columna con el código de una sede va a esa sede; una
 * columna con la etiqueta o clave de un campo propio va a ese campo.
 */
export function suggestMapping(
  headers: string[],
  ctx: { locationCodes: string[]; defaultLocationCode: string | null; attributes: { key: string; label: string }[] },
): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<string>();
  const take = (header: string, field: TargetField) => {
    if (used.has(field)) return;
    mapping[header] = field;
    used.add(field);
  };

  const locationOf = (h: string) =>
    ctx.locationCodes.find((code) => {
      const c = normalizeHeader(code);
      return c === h || h === `stock ${c}` || h === `existencia ${c}`;
    });

  // Primero las columnas que nombran una sede: ganan sobre "Existencia" genérica.
  for (const header of headers) {
    mapping[header] = "";
    const location = locationOf(normalizeHeader(header));
    if (location) take(header, `stock:${location}`);
  }

  for (const header of headers) {
    const h = normalizeHeader(header);
    if (!h || mapping[header] !== "" || locationOf(h)) continue;

    // Un título que es exactamente un campo del sistema ("CODIGO" → SKU) gana sobre un campo propio
    // con el mismo nombre (p. ej. el que guarda el código original de una importación anterior).
    const exact = HEADER_SYNONYMS.find(([names]) => names.includes(h))?.[1];
    if (exact && !used.has(exact) && !exact.startsWith("option:")) {
      take(header, exact);
      continue;
    }
    const attribute = ctx.attributes.find((a) => normalizeHeader(a.label) === h || normalizeHeader(a.key) === h);
    if (attribute) {
      take(header, `attr:${attribute.key}`);
      continue;
    }
    const matched = matchHeader(header);
    if (matched === "stock") {
      if (ctx.defaultLocationCode) take(header, `stock:${ctx.defaultLocationCode}`);
      continue;
    }
    // Encabezados tal como los escribe la exportación ("Número de parte / OEM", "Código oem").
    const codeKind = Object.entries(CODE_KIND_LABEL).find(([kind, label]) => normalizeHeader(label) === h || h === `codigo ${kind}`)?.[0];
    if (codeKind) {
      take(header, `code:${codeKind}`);
      continue;
    }
    if (matched) take(header, matched);
  }

  // Muchos Excels no tienen "Nombre": el nombre del artículo está en "Descripción".
  if (!used.has("name")) {
    const description = Object.keys(mapping).find((h) => mapping[h] === "description");
    if (description) mapping[description] = "name";
  }
  return mapping;
}

/** "Vehículo compatible" → "vehiculo_compatible". */
export function attributeKey(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "c_$1")
    .slice(0, 41);
}
