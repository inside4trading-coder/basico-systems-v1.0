/**
 * Fondo transparente: la IA entrega el producto sobre verde croma (#00FF00)
 * y aquí se vuelve transparente, sin acceso a red.
 *
 * Cada píxel se mide por cuánto domina el verde sobre el rojo y el azul.
 * Muy verde = fondo (transparente); poco verde = producto (opaco); en medio,
 * borde suave. En los bordes se quita el reflejo verde (despill) para que no
 * quede un halo. Un producto verde de verdad puede perder partes: por eso la
 * pantalla deja comparar antes de usar la foto.
 */

export const KEY_LOW = 40;
export const KEY_HIGH = 110;

/** Recorta en el lugar un búfer RGBA (como ImageData.data). Devuelve cuántos píxeles quedaron transparentes. */
export function keyOutGreen(rgba: Uint8ClampedArray, low = KEY_LOW, high = KEY_HIGH): number {
  let cleared = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    const greenness = g - Math.max(r, b);
    if (greenness <= low) continue;
    if (greenness >= high) {
      rgba[i + 3] = 0;
      cleared += 1;
      continue;
    }
    const keep = 1 - (greenness - low) / (high - low);
    rgba[i + 3] = Math.round(rgba[i + 3] * keep);
    // Despill: el verde del borde no pasa del mayor de los otros dos canales.
    rgba[i + 1] = Math.max(r, b);
  }
  return cleared;
}

/** Aplica el recorte a una imagen (URL o blob) y devuelve un PNG con transparencia. */
export async function transparentPng(source: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  keyOutGreen(image.data);
  ctx.putImageData(image, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("No se pudo preparar la imagen transparente");
  return blob;
}
