/** Tamaño y ruta de las fotos de productos, sin acceso a red. */

export const PRODUCT_IMAGES_BUCKET = "product-images";
export const MAX_SIDE_PX = 800;

/** Tamaño final manteniendo la proporción, sin agrandar fotos chicas. */
export function fitWithin(width: number, height: number, maxSide = MAX_SIDE_PX): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Ruta del archivo dentro del bucket si el enlace es de nuestro bucket; si no, null. */
export function storagePathOf(url: string | null): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${PRODUCT_IMAGES_BUCKET}/`;
  const i = url.indexOf(marker);
  return i === -1 ? null : decodeURIComponent(url.slice(i + marker.length));
}
