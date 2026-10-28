/**
 * El archivo ya convertido a la plantilla del sistema: mismas columnas que la
 * exportación del catálogo, con los SKU generados y los precios sin IVA, más
 * una columna «Revisión» con lo que hay que corregir. Al volver a subirlo,
 * sus títulos se reconocen solos.
 */
import { CODE_KIND_LABEL } from "./fields";
import type { PreviewRow } from "./preview";

type Cell = string | number | boolean | null;

export function normalizedTable(
  rows: PreviewRow[],
  ctx: { attributeLabels: Record<string, string>; locationCodes: string[] },
): { headers: string[]; data: Cell[][] } {
  const uniq = (values: string[]) => Array.from(new Set(values));
  const optionNames = uniq(rows.flatMap((r) => Object.keys((r.payload.variant.options as Record<string, string> | undefined) ?? {})));
  const codeKinds = uniq(rows.flatMap((r) => r.payload.codes.map((c) => c.kind)));
  const attrKeys = uniq(rows.flatMap((r) => r.payload.attributes.map((a) => a.key)));
  const multiSheet = new Set(rows.map((r) => r.sheet)).size > 1;

  const headers = [
    ...(optionNames.length ? ["Clave producto"] : []),
    "Nombre",
    "Marca",
    "Categoría",
    "Descripción",
    "SKU",
    ...optionNames,
    ...codeKinds.map((k) => CODE_KIND_LABEL[k] ?? `Código ${k}`),
    ...attrKeys.map((k) => ctx.attributeLabels[k] ?? k),
    "Precio sin IVA",
    "Oferta sin IVA",
    "Costo",
    "Unidad",
    ...ctx.locationCodes.map((c) => `Existencia ${c}`),
    ...(multiSheet ? ["Hoja"] : []),
    "Fila",
    "Revisión",
  ];

  const data = rows.map((r) => {
    const { product, variant, codes, attributes, stock } = r.payload;
    const options = (variant.options as Record<string, string> | undefined) ?? {};
    const text = (v: unknown) => (v == null || v === "" ? null : String(v));
    const num = (v: unknown) => (typeof v === "number" ? v : null);
    return [
      ...(optionNames.length ? [r.payload.product_key.replace(/#\d+$/, "")] : []),
      text(product.name),
      text(product.brand),
      text(product.category),
      text(product.description),
      r.payload.sku,
      ...optionNames.map((o) => options[o] ?? null),
      ...codeKinds.map((k) => codes.filter((c) => c.kind === k).map((c) => c.code).join("; ") || null),
      ...attrKeys.map((k) => attributes.filter((a) => a.key === k).map((a) => a.value).join("; ") || null),
      num(variant.regular_price),
      num(variant.price),
      num(variant.cost),
      text(variant.unit),
      ...ctx.locationCodes.map((c) => stock.find((s) => s.location_code === c.toLocaleUpperCase("es"))?.qty ?? null),
      ...(multiSheet ? [r.sheet] : []),
      r.rowNumber,
      [...r.errors, ...r.warnings].join(" | ") || null,
    ];
  });
  return { headers, data };
}
