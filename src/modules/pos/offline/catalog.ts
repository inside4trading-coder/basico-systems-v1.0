/**
 * Catálogo de la sede guardado en el dispositivo para buscar sin conexión.
 * La búsqueda imita catalog_lookup: SKU exacto, luego código exacto, luego
 * todas las palabras dentro del texto buscable.
 */
import type { PosHit } from "../api";
import type { KvStore } from "./kv";

export interface SnapshotRow {
  variant_id: string;
  product_id: string;
  product_name: string;
  options: Record<string, string>;
  brand: string | null;
  sku: string | null;
  price: number | null;
  unit: string;
  tax_rate: number;
  available: number;
  codes: string[];
  search: string;
}

export interface CatalogSnapshot {
  locationId: string;
  fetchedAt: string;
  rows: SnapshotRow[];
}

const snapshotKey = (tenantId: string, locationId: string) => `catalog:${tenantId}:${locationId}`;

export function loadSnapshot(store: KvStore, tenantId: string, locationId: string) {
  return store.get<CatalogSnapshot>(snapshotKey(tenantId, locationId));
}

export function saveSnapshot(store: KvStore, tenantId: string, snapshot: CatalogSnapshot) {
  return store.set(snapshotKey(tenantId, snapshot.locationId), snapshot);
}

function toHit(row: SnapshotRow, matchKind: string): PosHit {
  return {
    variant_id: row.variant_id,
    product_id: row.product_id,
    product_name: row.product_name,
    options: row.options ?? {},
    brand: row.brand,
    sku: row.sku,
    price: row.price,
    unit: row.unit,
    match_kind: matchKind,
    available: row.available,
    tax_rate: row.tax_rate,
  };
}

/** Minúsculas sin tildes: "Bujía" y "bujia" son lo mismo (igual que app.fold en la base). */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function localLookup(rows: SnapshotRow[], query: string, limit = 30): PosHit[] {
  const q = query.trim();
  if (!q) return [];
  const upper = q.toUpperCase();

  const bySku = rows.filter((r) => r.sku?.toUpperCase() === upper);
  if (bySku.length) return bySku.map((r) => toHit(r, "sku"));

  const byCode = rows.filter((r) => r.codes.some((c) => c.toUpperCase() === upper));
  if (byCode.length) return byCode.map((r) => toHit(r, "codigo"));

  const words = fold(q).split(/\s+/).filter(Boolean);
  return rows
    .filter((r) => {
      const text = fold(r.search);
      return words.every((w) => text.includes(w));
    })
    .slice(0, limit)
    .map((r) => toHit(r, "texto"));
}

/** Descuenta del disponible local lo vendido sin conexión, para no vender dos veces lo mismo. */
export function applyLocalSale(snapshot: CatalogSnapshot, items: ({ variant_id: string; qty: number } | { manual: true; qty: number })[]): CatalogSnapshot {
  const sold = new Map<string, number>();
  // Los conceptos manuales no tienen stock.
  for (const i of items) if ("variant_id" in i) sold.set(i.variant_id, (sold.get(i.variant_id) ?? 0) + i.qty);
  return {
    ...snapshot,
    rows: snapshot.rows.map((r) => (sold.has(r.variant_id) ? { ...r, available: Math.max(0, r.available - (sold.get(r.variant_id) ?? 0)) } : r)),
  };
}
