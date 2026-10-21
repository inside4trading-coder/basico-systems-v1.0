/**
 * Fotos de productos en el bucket público product-images, carpeta del
 * negocio. Se achican en el teléfono antes de subir (lado mayor 800 px, WebP)
 * para que el POS cargue rápido con datos móviles.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/core/supabase";
import { getActiveTenantId } from "@/core/tenant";
import { fitWithin, MAX_SIDE_PX, PRODUCT_IMAGES_BUCKET, storagePathOf } from "./photoPaths";

const MAX_INPUT_BYTES = 15 * 1024 * 1024;

/** Achica en el equipo y pasa a WebP (con transparencia, si la tiene). */
export async function shrinkPhoto(file: Blob, maxSide = MAX_SIDE_PX): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("El archivo no es una imagen");
  if (file.size > MAX_INPUT_BYTES) throw new Error("La foto pesa más de 15 MB");
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxSide);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
  if (!blob) throw new Error("No se pudo preparar la foto");
  return blob;
}

async function setImageUrl(productId: string, url: string | null) {
  const { error } = await supabase.from("products").update({ image_url: url }).eq("id", productId);
  if (error) throw new Error(error.message);
}

async function removeStored(url: string | null) {
  const path = storagePathOf(url);
  // Si no se pudo borrar el archivo viejo, la foto nueva igual queda puesta.
  if (path) await supabase.storage.from(PRODUCT_IMAGES_BUCKET).remove([path]);
}

export async function uploadProductPhoto(productId: string, file: File, previousUrl: string | null): Promise<string> {
  const tenant = getActiveTenantId();
  if (!tenant) throw new Error("Sin negocio activo");
  const blob = await shrinkPhoto(file);
  const path = `${tenant}/${productId}/${crypto.randomUUID()}.webp`;
  const { error } = await supabase.storage.from(PRODUCT_IMAGES_BUCKET).upload(path, blob, { contentType: "image/webp", upsert: false });
  if (error) throw new Error(`No se pudo subir la foto: ${error.message}`);
  const url = supabase.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl;
  await setImageUrl(productId, url);
  await removeStored(previousUrl);
  return url;
}

export async function removeProductPhoto(productId: string, previousUrl: string | null): Promise<void> {
  await setImageUrl(productId, null);
  await removeStored(previousUrl);
}

export function useProductPhoto() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["inv"] });
    qc.invalidateQueries({ queryKey: ["pos"] });
  };
  const upload = useMutation({
    mutationFn: ({ productId, file, previousUrl }: { productId: string; file: File; previousUrl: string | null }) =>
      uploadProductPhoto(productId, file, previousUrl),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: ({ productId, previousUrl }: { productId: string; previousUrl: string | null }) => removeProductPhoto(productId, previousUrl),
    onSuccess: invalidate,
  });
  return { upload, remove };
}
