import { describe, expect, it } from "vitest";
import { keyOutGreen } from "./chroma";

const px = (...colors: [number, number, number][]) => new Uint8ClampedArray(colors.flatMap(([r, g, b]) => [r, g, b, 255]));

describe("fondo transparente desde verde croma", () => {
  it("el verde croma desaparece", () => {
    const data = px([0, 255, 0], [10, 240, 20]);
    expect(keyOutGreen(data)).toBe(2);
    expect([data[3], data[7]]).toEqual([0, 0]);
  });

  it("el producto queda intacto (blanco, negro, rojo, gris, azul)", () => {
    const original = px([255, 255, 255], [0, 0, 0], [200, 30, 30], [128, 128, 128], [20, 60, 200]);
    const data = original.slice();
    expect(keyOutGreen(data)).toBe(0);
    expect(data).toEqual(original);
  });

  it("el borde queda semitransparente y sin reflejo verde", () => {
    const data = px([90, 165, 80]); // verde dominante en 75: a mitad de camino
    keyOutGreen(data);
    expect(data[3]).toBeGreaterThan(0);
    expect(data[3]).toBeLessThan(255);
    expect(data[1]).toBe(90);
  });
});
