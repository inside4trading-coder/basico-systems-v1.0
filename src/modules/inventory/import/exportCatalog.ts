/**
 * Exportación del catálogo en el mismo formato que la importación: el
 * archivo se puede editar en Excel y volver a subir. Portado de
 * downloadInventoryExport (basicosystems@f551478b), con una fila por variante
 * y una columna de existencia por sede en vez de una fila por sede.
 */
import { supabase } from "@/core/supabase";
import { fetchAllPages, type CatalogRow } from "../api";
import type { Location } from "../lib";
import type { AttributeDef } from "./api";
import { CODE_KIND_LABEL } from "./fields";
import { downloadXlsx } from "./files";
import { RUBROS, templateColumns, type RubroTemplate } from "./rubros";

export async function exportCatalog(rows: CatalogRow[], locations: Location[], defs: AttributeDef[], tenantSlug: string) {
  const values = await fetchAllPages<{ product_id: string; attribute_id: string; value: string }>((f, t) =>
    supabase.from("product_attribute_values").select("product_id, attribute_id, value").order("id").range(f, t),
  );
  const defById = new Map(defs.map((d) => [d.id, d]));
  const attrsByProduct = new Map<string, Map<string, string[]>>();
  for (const v of values) {
    const def = defById.get(v.attribute_id);
    if (!def) continue;
    const byKey = attrsByProduct.get(v.product_id) ?? new Map<string, string[]>();
    byKey.set(def.key, [...(byKey.get(def.key) ?? []), v.value]);
    attrsByProduct.set(v.product_id, byKey);
  }

  const optionNames = uniq(rows.flatMap((r) => Object.keys(r.variant.options ?? {})));
  const codeKinds = uniq(rows.flatMap((r) => r.codes.map((c) => c.kind)));
  const activeLocations = locations.filter((l) => l.is_active);

  const headers = [
    "Clave producto",
    "Nombre",
    "Marca",
    "Categoría",
    "SKU",
    ...optionNames,
    ...codeKinds.map((k) => CODE_KIND_LABEL[k] ?? `Código ${k}`),
    ...defs.map((d) => d.label),
    "Precio sin IVA",
    "Oferta sin IVA",
    "Costo",
    "Unidad",
    "Activo",
    ...activeLocations.map((l) => `Existencia ${l.code}`),
  ];

  const data = rows.map((r) => {
    const attrs = attrsByProduct.get(r.product.id);
    return [
      r.product.id.slice(0, 8),
      r.product.name,
      r.product.brand,
      r.product.category,
      r.variant.sku,
      ...optionNames.map((o) => r.variant.options?.[o] ?? null),
      ...codeKinds.map((k) => r.codes.filter((c) => c.kind === k).map((c) => c.code).join("; ") || null),
      ...defs.map((d) => attrs?.get(d.key)?.join("; ") ?? null),
      numberOrNull(r.variant.regular_price),
      numberOrNull(r.variant.price),
      numberOrNull(r.variant.cost),
      r.variant.unit,
      r.variant.is_active && r.product.is_active ? "Sí" : "No",
      ...activeLocations.map((l) => Number(r.stocks.find((s) => s.location_id === l.id)?.on_hand ?? 0)),
    ];
  });

  await downloadXlsx(`catalogo_${tenantSlug}_${new Date().toISOString().slice(0, 10)}.xlsx`, headers, data);
}

/** Plantilla vacía de un rubro, con una fila de ejemplo y columnas de existencia por sede. */
export async function downloadTemplate(rubro: RubroTemplate = RUBROS[0], locations: Location[]) {
  const codes = locations.filter((l) => l.is_active).map((l) => l.code);
  const columns = templateColumns(rubro, codes);
  await downloadXlsx(`plantilla_${rubro.id}.xlsx`, columns.map((c) => c.header), [columns.map((c) => c.example || null)]);
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values));
}

function numberOrNull(value: number | null): number | null {
  return value == null ? null : Number(value);
}
