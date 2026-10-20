import { describe, expect, it } from "vitest";
import { fitWithin, storagePathOf } from "./photos";

describe("fotos de productos", () => {
  it("achica al lado mayor de 800 px manteniendo la proporción", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1080, 1920)).toEqual({ width: 450, height: 800 });
  });

  it("no agranda fotos chicas", () => {
    expect(fitWithin(320, 240)).toEqual({ width: 320, height: 240 });
  });

  it("reconoce los archivos de nuestro bucket para borrarlos al reemplazar", () => {
    const url = "https://x.supabase.co/storage/v1/object/public/product-images/aaaa/bbbb/foto%201.webp";
    expect(storagePathOf(url)).toBe("aaaa/bbbb/foto 1.webp");
    expect(storagePathOf("https://otro-sitio.com/foto.jpg")).toBeNull();
    expect(storagePathOf(null)).toBeNull();
  });
});
