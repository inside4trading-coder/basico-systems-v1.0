/**
 * Datos de catálogo e inventario del tenant activo.
 *
 * Portado de src/hooks/useSublimeInventory.ts (basicosystems@f551478b). El
 * tenant lo filtra la RLS (header x-tenant-id), así que las queries no lo
 * repiten. A diferencia del origen, el stock nunca se escribe directo: todo
 * cambio pasa por las RPC inventory_entry/adjust/transfer/sign.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { withOfflineCache } from "@/core/offline";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";
import type { Location, LookupResult, MovementRow, Product, ProductCode, Stock, Variant, VariantOptions } from "./lib";

const PAGE = 1000;

type PageResult<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

/** PostgREST devuelve como mucho 1.000 filas por pedido; trae todas. */
export async function fetchAllPages<T>(build: (from: number, to: number) => PageResult<T>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

function useTenantKey() {
  const { active } = useTenant();
  return active?.tenant.id ?? "none";
}

function useInvalidateInventory() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["inv"] });
}

function rpcError(error: { message?: string } | null): Error {
  return new Error(error?.message ?? "Error desconocido");
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export function useLocations() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["inv", tenant, "locations"],
    queryFn: withOfflineCache(`locations:${tenant}`, async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("*")
        .is("deleted_at", null)
        .order("sells_in_pos", { ascending: false })
        .order("name");
      if (error) throw error;
      return (data ?? []) as Location[];
    }),
  });
}

export interface CatalogRow {
  product: Product;
  variant: Variant;
  stocks: Stock[];
  codes: ProductCode[];
}

export function useCatalog() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["inv", tenant, "catalog"],
    queryFn: async () => {
      const [products, variants, stocks, codes] = await Promise.all([
        fetchAllPages<Product>((f, t) => supabase.from("products").select("*").is("deleted_at", null).order("name").range(f, t)),
        fetchAllPages<Variant>((f, t) => supabase.from("variants").select("*").is("deleted_at", null).order("id").range(f, t)),
        fetchAllPages<Stock>((f, t) => supabase.from("stocks").select("*").order("id").range(f, t)),
        fetchAllPages<ProductCode>((f, t) => supabase.from("product_codes").select("*").order("id").range(f, t)),
      ]);

      const byProduct = new Map(products.map((p) => [p.id, p]));
      const stocksByVariant = groupBy(stocks, (s) => s.variant_id);
      const codesByVariant = groupBy(codes, (c) => c.variant_id);

      const rows: CatalogRow[] = variants
        .filter((v) => byProduct.has(v.product_id))
        .map((v) => ({
          product: byProduct.get(v.product_id)!,
          variant: v,
          stocks: stocksByVariant.get(v.id) ?? [],
          codes: codesByVariant.get(v.id) ?? [],
        }))
        .sort((a, b) => a.product.name.localeCompare(b.product.name) || (a.variant.sku ?? "").localeCompare(b.variant.sku ?? ""));

      return { products, rows };
    },
  });
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

export function useStockOf(variantId: string | null, locationId: string) {
  const tenant = useTenantKey();
  return useQuery({
    enabled: Boolean(variantId),
    queryKey: ["inv", tenant, "stock", variantId, locationId],
    queryFn: async () => {
      const { data, error } = await supabase.from("stocks").select("location_id, on_hand").eq("variant_id", variantId!);
      if (error) throw error;
      const rows = (data ?? []) as { location_id: string; on_hand: number }[];
      return {
        here: Number(rows.find((r) => r.location_id === locationId)?.on_hand ?? 0),
        total: rows.reduce((a, r) => a + Number(r.on_hand), 0),
      };
    },
  });
}

export function useMovements() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["inv", tenant, "movements"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_control_v")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as MovementRow[];
    },
  });
}

export async function lookupCatalog(query: string): Promise<LookupResult[]> {
  const { data, error } = await supabase.rpc("catalog_lookup", { p_query: query });
  if (error) throw rpcError(error);
  return (data ?? []) as LookupResult[];
}

// ---------------------------------------------------------------------------
// Sedes
// ---------------------------------------------------------------------------

export function useSaveLocation() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: async (input: Partial<Location> & Pick<Location, "name" | "code">) => {
      const { id, ...fields } = input;
      const payload = {
        name: fields.name.trim(),
        code: fields.code.trim().toUpperCase(),
        type: fields.type ?? "store",
        sells_in_pos: fields.sells_in_pos ?? true,
        is_active: fields.is_active ?? true,
      };
      const { error } = id
        ? await supabase.from("locations").update(payload).eq("id", id)
        : await supabase.from("locations").insert(payload);
      if (error) throw rpcError(error);
    },
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

export interface NewVariantInput {
  options: VariantOptions;
  sku: string;
  barcode: string;
  regularPrice: number | null;
  price: number | null;
  cost: number | null;
}

export interface NewProductInput {
  name: string;
  brand: string;
  category: string;
  unit: string;
  /** null = el impuesto por defecto del negocio. */
  taxRateId: string | null;
  variants: NewVariantInput[];
}

/**
 * Alta de producto con sus variantes y códigos de barras. Son varios
 * inserts: si uno falla, se marca el producto como borrado para no dejar
 * medio producto visible.
 */
export function useCreateProduct() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: async (input: NewProductInput) => {
      const { data: product, error: productError } = await supabase
        .from("products")
        .insert({
          name: input.name.trim(),
          brand: input.brand.trim() || null,
          category: input.category.trim() || null,
          tax_rate_id: input.taxRateId,
        })
        .select("id")
        .single();
      if (productError || !product) throw rpcError(productError);

      try {
        for (const v of input.variants) {
          const { data: variant, error: variantError } = await supabase
            .from("variants")
            .insert({
              product_id: product.id,
              options: v.options,
              sku: v.sku.trim() || null,
              regular_price: v.regularPrice,
              price: v.price ?? v.regularPrice,
              cost: v.cost,
              unit: input.unit.trim() || "unidad",
            })
            .select("id")
            .single();
          if (variantError || !variant) throw rpcError(variantError);

          if (v.barcode.trim()) {
            const { error: codeError } = await supabase
              .from("product_codes")
              .insert({ variant_id: variant.id, kind: "barcode", code: v.barcode.trim() });
            if (codeError) throw rpcError(codeError);
          }
        }
      } catch (err) {
        await supabase.from("products").update({ deleted_at: new Date().toISOString() }).eq("id", product.id);
        throw err;
      }
      return product.id as string;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateVariant() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Pick<Variant, "sku" | "regular_price" | "price" | "cost" | "is_active">> }) => {
      const { error } = await supabase.from("variants").update(patch).eq("id", id);
      if (error) throw rpcError(error);
    },
    onSuccess: invalidate,
  });
}

export function useUpdateProduct() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Pick<Product, "name" | "brand" | "category" | "is_active">> }) => {
      const { error } = await supabase.from("products").update(patch).eq("id", id);
      if (error) throw rpcError(error);
    },
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------
// Movimientos (RPC)
// ---------------------------------------------------------------------------

export interface EntryInput {
  variantId: string;
  locationId: string;
  qty: number;
  unitCost?: number | null;
  supplier?: string | null;
  note?: string | null;
  expectedQty?: number | null;
}

export async function registerEntry(input: EntryInput): Promise<{ before: number; after: number }> {
  const { data, error } = await supabase.rpc("inventory_entry", {
    p_variant_id: input.variantId,
    p_location_id: input.locationId,
    p_qty: input.qty,
    p_unit_cost: input.unitCost ?? null,
    p_supplier: input.supplier ?? null,
    p_note: input.note ?? null,
    p_expected_qty: input.expectedQty ?? null,
  });
  if (error) throw rpcError(error);
  return data as { before: number; after: number };
}

export function useAdjust() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: async (input: {
      variantId: string;
      locationId: string;
      delta: number;
      reason: string;
      note?: string | null;
      correctsId?: string | null;
    }) => {
      const { data, error } = await supabase.rpc("inventory_adjust", {
        p_variant_id: input.variantId,
        p_location_id: input.locationId,
        p_delta: input.delta,
        p_reason: input.reason,
        p_note: input.note ?? null,
        p_corrects_id: input.correctsId ?? null,
      });
      if (error) throw rpcError(error);
      return data as { before: number; after: number };
    },
    onSuccess: invalidate,
  });
}

export function useSign() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: async ({ movementId, note }: { movementId: string; note?: string | null }) => {
      const { error } = await supabase.rpc("inventory_sign", { p_movement_id: movementId, p_note: note ?? null });
      if (error) throw rpcError(error);
    },
    onSuccess: invalidate,
  });
}

export function useTransfer() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: async (input: { variantId: string; from: string; to: string; qty: number; note?: string | null }) => {
      const { data, error } = await supabase.rpc("inventory_transfer", {
        p_variant_id: input.variantId,
        p_from_location: input.from,
        p_to_location: input.to,
        p_qty: input.qty,
        p_note: input.note ?? null,
      });
      if (error) throw rpcError(error);
      return data as { from_after: number; to_after: number };
    },
    onSuccess: invalidate,
  });
}

export { useInvalidateInventory };
