import { CAPABILITIES } from "../../../src/core/capabilities";
import { GUIDES, quotedLabels } from "./beto-guides";

/**
 * Guarda de las guías de [B]eto: si alguien cambia un botón, una ruta o un
 * permiso, este test avisa para actualizar la guía y que [B]eto no enseñe
 * pasos que ya no existen.
 */
const sources = import.meta.glob(["/src/**/*.tsx", "!/src/**/*.test.tsx"], { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;
const navAndRoutes = [
  ...Object.values(import.meta.glob("/src/components/nav/navModules.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>),
  ...Object.values(import.meta.glob("/src/App.tsx", { query: "?raw", import: "default", eager: true }) as Record<string, string>),
].join("\n");
const allTsx = Object.values(sources).join("\n");

describe("guías de [B]eto", () => {
  it("ids únicos", () => {
    const ids = GUIDES.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(GUIDES.map((g) => [g.id, g] as const))("%s: la ruta existe", (_id, g) => {
    const path = g.ruta.split(/[?#]/)[0];
    expect(navAndRoutes.includes(`"${path}"`) || navAndRoutes.includes(`path="${path}"`)).toBe(true);
  });

  it.each(GUIDES.filter((g) => g.capacidad).map((g) => [g.id, g] as const))("%s: la capacidad existe", (_id, g) => {
    expect(Object.keys(CAPABILITIES)).toContain(g.capacidad);
  });

  it("ya distinguen factura fiscal y nota de entrega", () => {
    const text = JSON.stringify(GUIDES);
    expect(text).not.toContain("Hoy no se distingue");
    const guide = (id: string) => JSON.stringify(GUIDES.find((g) => g.id === id));
    expect(guide("compra_a_credito")).toContain("nota de entrega");
    expect(guide("por_pagar")).toContain("«Cambiar a factura»");
  });

  it.each(GUIDES.map((g) => [g.id, g] as const))("%s: cada «etiqueta» está en la app", (_id, g) => {
    const missing = quotedLabels(g).filter((label) => !allTsx.includes(label));
    expect(missing).toEqual([]);
  });
});
