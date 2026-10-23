import { describe, expect, it } from "vitest";
import { roleAllows, type Capability } from "@/core/capabilities";
import { ENTITLEMENT_DEFAULTS } from "@/core/entitlements";
import type { TenantRole } from "@/core/tenant-selection";
import { isItemActive, moduleForPath, NAV_MODULES, visibleModules, type Modules } from "./navModules";

const asRole = (role: TenantRole) => (c: Capability) => roleAllows(role, c, []);
const plan: Modules = { ...ENTITLEMENT_DEFAULTS };
const keys = (role: TenantRole, modules: Modules = plan) => visibleModules(asRole(role), modules).map((m) => m.key);

describe("visibleModules", () => {
  it("el dueño ve los módulos de su plan", () => {
    expect(keys("owner")).toEqual(["inicio", "comercial", "inventario", "administracion", "reportes", "equipo", "configuracion"]);
  });

  it("los complementos aparecen al activarlos", () => {
    expect(keys("owner", { ...plan, estudio: true })).toContain("estudio");
    const admin = visibleModules(asRole("owner"), { ...plan, cashea: true }).find((m) => m.key === "administracion")!;
    expect(admin.groups.map((g) => g.label)).toContain("Cashea");
  });

  it("el cajero solo ve lo que su rol permite", () => {
    expect(keys("cajero")).toEqual(["inicio", "comercial", "inventario"]);
    const inv = visibleModules(asRole("cajero"), plan).find((m) => m.key === "inventario")!;
    const labels = inv.groups.flatMap((g) => g.items.map((i) => i.label));
    expect(labels).toContain("Conteos");
    expect(labels).not.toContain("Entrada rápida");
    expect(labels).not.toContain("Importar y exportar");
  });

  it("sin el módulo del plan no sale", () => {
    expect(keys("owner", { ...plan, administracion: false })).not.toContain("administracion");
  });
});

describe("isItemActive", () => {
  const admin = NAV_MODULES.find((m) => m.key === "administracion")!;
  const items = admin.groups.flatMap((g) => g.items);
  const at = (pathname: string, search = "", hash = "") => ({ pathname, search, hash });

  it("marca la pestaña de la dirección", () => {
    const active = items.filter((i) => isItemActive(i, at("/administracion", "?tab=movements"), items));
    expect(active.map((i) => i.label)).toEqual(["Movimientos"]);
  });

  it("sin ?tab= marca la primera pestaña", () => {
    const active = items.filter((i) => isItemActive(i, at("/administracion"), items));
    expect(active.map((i) => i.label)).toEqual(["Resumen"]);
  });

  it("las secciones se marcan por #", () => {
    const conf = NAV_MODULES.find((m) => m.key === "configuracion")!.groups.flatMap((g) => g.items);
    expect(conf.filter((i) => isItemActive(i, at("/configuracion", "", "#tasa"), conf)).map((i) => i.label)).toEqual(["Tasa de cambio"]);
  });
});

describe("moduleForPath", () => {
  it("encuentra el módulo de la página", () => {
    expect(moduleForPath("/control", NAV_MODULES)?.key).toBe("inventario");
    expect(moduleForPath("/fichaje", NAV_MODULES)?.key).toBe("equipo");
    expect(moduleForPath("/sedes", NAV_MODULES)?.key).toBe("configuracion");
    expect(moduleForPath("/plataforma", NAV_MODULES)).toBeNull();
  });
});
