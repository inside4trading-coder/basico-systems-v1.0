/** Estudio de IA: cuota, historial y generación (edge function studio-generate). */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/core/supabase";
import { getActiveTenantId } from "@/core/tenant";
import { useTenant } from "@/core/tenant-context";
import { shrinkPhoto, uploadProductPhoto } from "@/modules/inventory/photos";
import { PRODUCT_IMAGES_BUCKET, storagePathOf } from "@/modules/inventory/photoPaths";
import { transparentPng } from "./chroma";

export type StudioKind = "catalogo" | "transparente" | "ambientado";

export const KIND_INFO: Record<StudioKind, { title: string; description: string }> = {
  catalogo: { title: "Foto de catálogo", description: "Fondo blanco, luz de estudio, el producto centrado." },
  transparente: { title: "Fondo transparente", description: "Producto recortado, para usar sobre cualquier fondo." },
  ambientado: { title: "Ambientada", description: "El producto en un lugar que describas." },
};

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
        .select("id, product_id, kind, scene, status, result_path, error, created_at, products(name)")
        .order("created_at", { ascending: false })
        .limit(60);
      if (error) throw asError(error);
      return (data ?? []) as unknown as StudioJob[];
    },
  });
}

/** Sube la foto de origen (achicada a 1280 px) a la carpeta del negocio, o reutiliza la foto actual. */
async function sourcePathFor(productId: string, file: File | null, currentUrl: string | null): Promise<string> {
  const tenant = getActiveTenantId();
  if (!tenant) throw new Error("Sin negocio activo");
  if (!file) {
    const existing = storagePathOf(currentUrl);
    if (existing) return existing;
    throw new Error("Toma o elige una foto del producto");
  }
  const blob = await shrinkPhoto(file, 1280);
  const path = `${tenant}/${productId}/estudio-origen-${crypto.randomUUID()}.webp`;
  const { error } = await supabase.storage.from(PRODUCT_IMAGES_BUCKET).upload(path, blob, { contentType: "image/webp", upsert: false });
  if (error) throw new Error(`No se pudo subir la foto: ${error.message}`);
  return path;
}

export interface GenerateInput {
  productId: string;
  kind: StudioKind;
  scene: string | null;
  file: File | null;
  currentUrl: string | null;
}

export function useGenerate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: GenerateInput) => {
      const sourcePath = await sourcePathFor(input.productId, input.file, input.currentUrl);
      const { data, error } = await supabase.functions.invoke("studio-generate", {
        body: { product_id: input.productId, kind: input.kind, scene: input.scene, source_path: sourcePath },
      });
      if (error) throw asError(error);
      if (data?.error) throw new Error(data.error as string);
      return data as { jobId: string; url: string; path: string; kind: StudioKind };
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["studio"] }),
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
