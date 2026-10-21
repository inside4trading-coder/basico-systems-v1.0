import { describe, expect, it } from "vitest";
import { allowedShortcuts, moveKey, pushRecent, selectShortcuts, shortcutForPath, SHORTCUTS } from "./shortcuts";

const all = { pos: true, inventario: true, administracion: true, reportes: true, fichaje: true };
const keys = (rows: { key: string }[]) => rows.map((r) => r.key);

describe("catálogo de accesos de Inicio", () => {
  it("claves únicas y con el formato que acepta la base", () => {
    const k = keys(SHORTCUTS);
    expect(new Set(k).size).toBe(k.length);
    for (const key of k) expect(key).toMatch(/^[a-z][a-z0-9_-]{1,39}$/);
  });

  it("el cajero no ve reportes, administración, sedes ni equipo", () => {
    const k = keys(allowedShortcuts("cajero", all));
    expect(k).toContain("pos");
    expect(k).toContain("conteos");
    expect(k).not.toContain("reportes");
    expect(k).not.toContain("obligaciones");
    expect(k).not.toContain("entrada");
    expect(k).not.toContain("sedes");
    expect(k).not.toContain("equipo");
  });

  it("el encargado ve reportes pero no configura el negocio", () => {
    const k = keys(allowedShortcuts("manager", all));
    expect(k).toEqual(expect.arrayContaining(["reportes", "conciliacion", "reposicion", "importar"]));
    expect(k).not.toContain("configuracion");
    expect(k).not.toContain("equipo");
  });

  it("el dueño ve todo el catálogo con todos los módulos", () => {
    expect(allowedShortcuts("owner", all)).toHaveLength(SHORTCUTS.length);
  });

  it("Fichaje es un add-on: sin él, su acceso no aparece", () => {
    expect(keys(allowedShortcuts("owner", { ...all, fichaje: false }))).not.toContain("fichaje");
    expect(keys(allowedShortcuts("owner", all))).toContain("fichaje");
  });

  it("sin el módulo en el plan, sus accesos no aparecen", () => {
    const k = keys(allowedShortcuts("owner", { ...all, administracion: false, pos: false }));
    expect(k).not.toContain("administracion");
    expect(k).not.toContain("conciliacion");
    expect(k).not.toContain("pos");
    expect(k).not.toContain("clientes");
    expect(k).toContain("reportes");
    expect(k).toContain("sedes");
  });
});

describe("accesos elegidos", () => {
  it("sin elección: los de siempre según lo permitido", () => {
    expect(keys(selectShortcuts(null, allowedShortcuts("owner", all)))).toEqual([
      "pos",
      "inventario",
      "control",
      "conteos",
      "reposicion",
      "reportes",
    ]);
    expect(keys(selectShortcuts(undefined, allowedShortcuts("cajero", all)))).toEqual(["pos", "inventario", "control", "conteos"]);
  });

  it("sin elección y sin inventario ni POS: lo que queda", () => {
    expect(keys(selectShortcuts(null, allowedShortcuts("owner", { reportes: true })))).toEqual(["reportes"]);
  });

  it("respeta el orden guardado y descarta lo que ya no se permite o no existe", () => {
    const allowed = allowedShortcuts("cajero", all);
    expect(keys(selectShortcuts(["conteos", "reportes", "viejo", "pos", "conteos"], allowed))).toEqual(["conteos", "pos"]);
  });

  it("una lista vacía guardada es una elección: no vuelve a los de siempre", () => {
    expect(selectShortcuts([], allowedShortcuts("owner", all))).toEqual([]);
  });

  it("mover arriba y abajo sin salirse de la lista", () => {
    expect(moveKey(["a", "b", "c"], "c", -1)).toEqual(["a", "c", "b"]);
    expect(moveKey(["a", "b", "c"], "a", 1)).toEqual(["b", "a", "c"]);
    expect(moveKey(["a", "b"], "a", -1)).toEqual(["a", "b"]);
    expect(moveKey(["a", "b"], "z", 1)).toEqual(["a", "b"]);
  });
});

describe("actividad reciente", () => {
  it("la última visita va primero, sin repetidos y con tope", () => {
    expect(pushRecent(["/pos", "/control", "/reportes", "/sedes"], "/reportes")).toEqual(["/reportes", "/pos", "/control", "/sedes"]);
    expect(pushRecent(["/a", "/b", "/c", "/d"], "/e")).toEqual(["/e", "/a", "/b", "/c"]);
  });

  it("reconoce la pestaña y, si no, la página", () => {
    expect(shortcutForPath("/control?tab=conteos")?.key).toBe("conteos");
    expect(shortcutForPath("/control?tab=otra")?.key).toBe("control");
    expect(shortcutForPath("/no-existe")).toBeUndefined();
  });
});
