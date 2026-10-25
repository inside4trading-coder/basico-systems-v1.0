/** Etiquetas por unidad: productos activados, generar, marcar impresas y desactivar. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";

export interface UnitOverviewRow {
  product_id: string;
  product_name: string;
  variant_id: string;
  sku: string | null;
  options: Record<string, string> | null;
  unit: string;
  on_hand: number;
  active_labels: number;
  to_print: number;
  disabled_labels: number;
}

export type ItemLabelStatus = "generated" | "printed" | "disabled";

export interface ItemLabel {
  id: string;
  variant_id: string;
  unit_number: number | null;
  code: string;
  is_serial: boolean;
  status: ItemLabelStatus;
  origin: string;
  disabled_reason: string | null;
  created_at: string;
  printed_at: string | null;
}

export const ITEM_STATUS_LABEL: Record<ItemLabelStatus, string> = {
  generated: "Por imprimir",
  printed: "Impresa",
  disabled: "Desactivada",
};

/** Unidades con stock que aún no tienen etiqueta activa. */
export const missingLabels = (r: Pick<UnitOverviewRow, "on_hand" | "active_labels">) =>
  Math.max(0, Math.floor(Number(r.on_hand)) - Number(r.active_labels));

/** Seriales escritos o escaneados: uno por línea (o separados por coma), sin vacíos. */
export function parseSerials(text: string): string[] {
  return text
    .split(/[\n,;\t]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function useTenantKey() {
  const { active } = useTenant();
  return active?.tenant.id ?? "none";
}

const fail = (error: { message?: string } | null) => new Error(error?.message ?? "Error desconocido");

export function useUnitOverview() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["item-labels", tenant, "overview"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("item_label_overview");
      if (error) throw fail(error);
      return ((data ?? []) as UnitOverviewRow[]).map((r) => ({
        ...r,
        on_hand: Number(r.on_hand),
        active_labels: Number(r.active_labels),
        to_print: Number(r.to_print),
        disabled_labels: Number(r.disabled_labels),
      }));
    },
  });
}

export function useVariantItemLabels(variantId: string | null) {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["item-labels", tenant, "variant", variantId],
    enabled: Boolean(variantId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("item_labels")
        .select("id, variant_id, unit_number, code, is_serial, status, origin, disabled_reason, created_at, printed_at")
        .eq("variant_id", variantId)
        .order("created_at")
        .order("unit_number");
      if (error) throw fail(error);
      return (data ?? []) as ItemLabel[];
    },
  });
}

/** Etiquetas por id (para imprimir las recién generadas o las pendientes). */
export async function fetchItemLabels(filter: { ids?: string[]; variantId?: string; status?: ItemLabelStatus }): Promise<ItemLabel[]> {
  let q = supabase
    .from("item_labels")
    .select("id, variant_id, unit_number, code, is_serial, status, origin, disabled_reason, created_at, printed_at");
  if (filter.ids) q = q.in("id", filter.ids);
  if (filter.variantId) q = q.eq("variant_id", filter.variantId);
  if (filter.status) q = q.eq("status", filter.status);
  const { data, error } = await q.order("created_at").order("unit_number").limit(500);
  if (error) throw fail(error);
  return (data ?? []) as ItemLabel[];
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["item-labels"] });
}

export function useSetTrackUnits() {
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ productId, enabled }: { productId: string; enabled: boolean }) => {
      const { error } = await supabase.rpc("set_product_track_units", { p_product_id: productId, p_enabled: enabled });
      if (error) throw fail(error);
    },
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["inv"] });
    },
  });
}

export function useGenerateItemLabels() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: { variantId: string; quantity?: number; serials?: string[]; origin?: string; movementId?: string | null }) => {
      const { data, error } = await supabase.rpc("generate_item_labels", {
        p_variant_id: input.variantId,
        p_quantity: input.quantity ?? null,
        p_serials: input.serials?.length ? input.serials : null,
        p_origin: input.origin ?? "manual",
        p_movement_id: input.movementId ?? null,
      });
      if (error) throw fail(error);
      return data as { created: number; ids: string[] };
    },
    onSuccess: invalidate,
  });
}

export function useMarkItemLabelsPrinted() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { data, error } = await supabase.rpc("mark_item_labels_printed", { p_ids: ids });
      if (error) throw fail(error);
      return data as number;
    },
    onSuccess: invalidate,
  });
}

export function useDisableItemLabels() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ ids, reason }: { ids: string[]; reason: string }) => {
      const { data, error } = await supabase.rpc("disable_item_labels", { p_ids: ids, p_reason: reason });
      if (error) throw fail(error);
      return data as number;
    },
    onSuccess: invalidate,
  });
}

/** Nombre, variante, marca y PVP base de las variantes a imprimir. */
export async function fetchVariantInfo(ids: string[]) {
  const { data, error } = await supabase
    .from("variants")
    .select("id, sku, options, price, regular_price, products(name, brand, tax_rate_id)")
    .in("id", ids);
  if (error) throw fail(error);
  return new Map(
    (data ?? []).map((v) => {
      const p = v.products as unknown as { name: string; brand: string | null; tax_rate_id: string | null } | null;
      return [
        v.id as string,
        {
          name: p?.name ?? "Producto",
          detail: [Object.values((v.options as Record<string, string> | null) ?? {}).join(" · "), p?.brand].filter(Boolean).join(" · ") || null,
          sku: (v.sku as string | null) ?? null,
          net: (v.price as number | null) ?? (v.regular_price as number | null) ?? 0,
          taxRateId: p?.tax_rate_id ?? null,
        },
      ];
    }),
  );
}

export interface QueueRow {
  movement_id: string;
  received_at: string;
  location_name: string;
  supplier: string | null;
  note: string | null;
  product_id: string;
  product_name: string;
  variant_id: string;
  sku: string | null;
  options: Record<string, string> | null;
  qty: number;
  labeled: number;
  pending: number;
}

/** Entradas de mercancía de productos por unidad que tienen piezas sin etiquetar. */
export function useItemLabelQueue() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["item-labels", tenant, "queue"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("item_label_queue");
      if (error) throw fail(error);
      return ((data ?? []) as QueueRow[]).map((r) => ({ ...r, qty: Number(r.qty), labeled: Number(r.labeled), pending: Number(r.pending) }));
    },
  });
}

export function useDismissEntry() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ movementId, reason }: { movementId: string; reason: string }) => {
      const { error } = await supabase.rpc("dismiss_item_label_entry", { p_movement_id: movementId, p_reason: reason });
      if (error) throw fail(error);
    },
    onSuccess: invalidate,
  });
}
