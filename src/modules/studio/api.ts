/** Estudio de IA: cuota, historial y generación (edge function studio-generate). */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/core/supabase";
import { getActiveTenantId } from "@/core/tenant";
import { useTenant } from "@/core/tenant-context";
import { shrinkPhoto, uploadProductPhoto } from "@/modules/inventory/photos";
import { PRODUCT_IMAGES_BUCKET, storagePathOf } from "@/modules/inventory/photoPaths";
import { transparentPng } from "./chroma";

export type StudioKind = "catalogo" | "transparente" | "ambientado" | "persona";
export type StudioFormat = "1:1" | "4:5" | "9:16" | "16:9";

export const KIND_INFO: Record<StudioKind, { title: string; description: string }> = {
  catalogo: { title: "Foto para catálogo", description: "Imagen limpia y profesional para tienda en línea y catálogo." },
  transparente: { title: "Fondo transparente", description: "Aísla el producto y entrega un PNG limpio para diseño y composición." },
  ambientado: { title: "Fondo dinámico", description: "Escenas para campañas, redes y carruseles." },
  persona: { title: "Producto con persona", description: "Una persona generada con IA usando o sosteniendo el producto." },
};

export const FORMAT_OPTIONS: { value: StudioFormat; label: string }[] = [
  { value: "1:1", label: "Cuadrado 1:1" },
  { value: "4:5", label: "Instagram 4:5" },
  { value: "9:16", label: "Story 9:16" },
  { value: "16:9", label: "Web 16:9" },
];

export const FORMAT_ASPECT: Record<StudioFormat, string> = { "1:1": "aspect-square", "4:5": "aspect-[4/5]", "9:16": "aspect-[9/16]", "16:9": "aspect-video" };

/** Vistas extra del producto (la principal es el frente). */
export const EXTRA_VIEWS = [
  { key: "espalda", label: "Espalda / reverso" },
  { key: "detalle", label: "Detalle" },
  { key: "tres_cuartos", label: "Tres cuartos" },
] as const;

export interface StudioSettings {
  prompts: Partial<Record<StudioKind, string>>;
  brand_name: string | null;
  brand_colors: string[];
  people_enabled: boolean;
}

export const DEFAULT_SETTINGS: StudioSettings = { prompts: {}, brand_name: null, brand_colors: [], people_enabled: false };

/** Ambientes de partida; se puede escribir cualquiera. */
export const SCENE_IDEAS = [
  "sobre una mesa de madera clara, con luz de ventana",
  "en el estante de una tienda ordenada",
  "sobre un mesón de taller limpio",
  "al aire libre, luz de tarde, fondo desenfocado",
  "sobre una superficie de mármol blanco, estilo minimalista",
];

export interface StudioJob {
  id: string;
  product_id: string;
  kind: StudioKind;
  scene: string | null;
  status: "pendiente" | "listo" | "fallido";
  set_id: string | null;
  format: StudioFormat;
  notes: string | null;
  result_path: string | null;
  error: string | null;
  created_at: string;
  products: { name: string } | null;
}

function asError(error: { message?: string } | null): Error {
  return new Error(error?.message ?? "Error desconocido");
}

function useTenantKey() {
  const { active } = useTenant();
  return active?.tenant.id ?? "none";
}

export function publicUrlOf(path: string): string {
  return supabase.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl;
}

export function useStudioUsage() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["studio", tenant, "usage"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("studio_usage");
      if (error) throw asError(error);
      return (data ?? { used: 0, limit: 0 }) as { used: number; limit: number };
    },
  });
}

export function useStudioJobs() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["studio", tenant, "jobs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("studio_jobs")
        .select("id, product_id, kind, scene, status, set_id, format, notes, result_path, error, created_at, products(name)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw asError(error);
      return (data ?? []) as unknown as StudioJob[];
    },
  });
}

/** Sube una foto (achicada a 1280 px) a la carpeta del negocio. */
async function uploadSource(productId: string, file: File): Promise<string> {
  const tenant = getActiveTenantId();
  if (!tenant) throw new Error("Sin negocio activo");
  const blob = await shrinkPhoto(file, 1280);
  const path = `${tenant}/${productId}/estudio-origen-${crypto.randomUUID()}.webp`;
  const { error } = await supabase.storage.from(PRODUCT_IMAGES_BUCKET).upload(path, blob, { contentType: "image/webp", upsert: false });
  if (error) throw new Error(`No se pudo subir la foto: ${error.message}`);
  return path;
}

/** La foto principal: la nueva, o la actual del producto. */
async function sourcePathFor(productId: string, file: File | null, currentUrl: string | null): Promise<string> {
  if (file) return uploadSource(productId, file);
  const existing = storagePathOf(currentUrl);
  if (existing) return existing;
  throw new Error("Toma o elige una foto del producto");
}

export interface GenerateInput {
  productId: string;
  kind: StudioKind;
  scene: string | null;
  file: File | null;
  currentUrl: string | null;
  /** Vistas extra (hasta 3). */
  extraFiles: File[];
  notes: string | null;
  format: StudioFormat;
  /** Cuántas imágenes del set (1 a 4); cada una gasta una foto de la cuota. */
  outputs: number;
}

export interface GeneratedImage {
  jobId: string;
  url: string;
  path: string;
  kind: StudioKind;
  format: StudioFormat;
}

/** Genera un set: sube las fotos una vez y pide cada imagen en paralelo. */
export function useGenerate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: GenerateInput) => {
      const sourcePath = await sourcePathFor(input.productId, input.file, input.currentUrl);
      const extraPaths = await Promise.all(input.extraFiles.slice(0, 3).map((f) => uploadSource(input.productId, f)));
      const setId = crypto.randomUUID();
      const one = async () => {
        const { data, error } = await supabase.functions.invoke("studio-generate", {
          body: {
            product_id: input.productId,
            kind: input.kind,
            scene: input.scene,
            source_path: sourcePath,
            set_id: setId,
            format: input.format,
            extra_paths: extraPaths,
            notes: input.notes,
          },
        });
        if (error) throw asError(error);
        if (data?.error) throw new Error(data.error as string);
        return data as GeneratedImage;
      };
      const count = Math.min(4, Math.max(1, input.outputs));
      const results = await Promise.allSettled(Array.from({ length: count }, one));
      const images = results.filter((r): r is PromiseFulfilledResult<GeneratedImage> => r.status === "fulfilled").map((r) => r.value);
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      if (images.length === 0) throw failed[0]?.reason ?? new Error("No se generó ninguna imagen");
      return { setId, images, failed: failed.length, firstError: failed[0] ? (failed[0].reason as Error).message : null };
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["studio"] }),
  });
}

export function useStudioSettings() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["studio", tenant, "settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("studio_settings").select("prompts, brand_name, brand_colors, people_enabled").maybeSingle();
      if (error) throw asError(error);
      return (data ?? DEFAULT_SETTINGS) as StudioSettings;
    },
  });
}

export function useSaveStudioSettings() {
  const qc = useQueryClient();
  const tenant = useTenantKey();
  return useMutation({
    mutationFn: async (settings: StudioSettings) => {
      const { error } = await supabase.from("studio_settings").upsert({ tenant_id: tenant, ...settings }, { onConflict: "tenant_id" });
      if (error) throw asError(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["studio"] }),
  });
}

/** Pone el resultado como foto del producto (recortando el verde si es transparente). */
export function useApplyResult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { productId: string; resultUrl: string; kind: StudioKind; previousUrl: string | null }) => {
      const res = await fetch(input.resultUrl);
      if (!res.ok) throw new Error("No se pudo leer la imagen generada");
      let blob = await res.blob();
      if (input.kind === "transparente") blob = await transparentPng(blob);
      const file = new File([blob], "estudio.png", { type: blob.type || "image/png" });
      return uploadProductPhoto(input.productId, file, input.previousUrl);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inv"] });
      qc.invalidateQueries({ queryKey: ["pos"] });
    },
  });
}
