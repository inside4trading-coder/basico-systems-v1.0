import { describe, expect, it } from "vitest";
import migrationSql from "../../supabase/migrations/20261205000000_role_capabilities.sql?raw";
import { CAPABILITIES, CAPABILITY_KEYS, EDITABLE_ROLES, resolveCapabilities, roleAllows } from "./capabilities";

describe("roleAllows", () => {
  it("el owner puede todo, aunque haya excepciones", () => {
    expect(roleAllows("owner", "config.negocio", [{ role: "owner", capability: "config.negocio", allowed: false }])).toBe(true);
  });

  it("sin excepciones usa el default del rol", () => {
    expect(roleAllows("cajero", "pos.vender", [])).toBe(true);
    expect(roleAllows("cajero", "reportes.ver", [])).toBe(false);
    expect(roleAllows("manager", "catalogo.editar", [])).toBe(true);
  });

  it("la excepción del negocio gana al default", () => {
    const overrides = [
      { role: "manager", capability: "catalogo.editar", allowed: false },
      { role: "cajero", capability: "reportes.ver", allowed: true },
    ];
    expect(roleAllows("manager", "catalogo.editar", overrides)).toBe(false);
    expect(roleAllows("cajero", "reportes.ver", overrides)).toBe(true);
  });

  it("sin rol no puede nada", () => {
    expect(resolveCapabilities(undefined, []).size).toBe(0);
  });
});

describe("defaults en la base", () => {
  // app.capability_defaults(): un jsonb_build_object por rol.
  const blocks = Object.fromEntries(
    [...migrationSql.matchAll(/'(admin|manager|cajero)', jsonb_build_object\(([\s\S]*?)\)/g)].map((m) => [
      m[1],
      Object.fromEntries([...m[2].matchAll(/'([a-z_]+\.[a-z_]+)', (true|false)/g)].map((x) => [x[1], x[2] === "true"])),
    ]),
  );

  it("tiene las mismas capacidades que la app", () => {
    for (const role of EDITABLE_ROLES) expect(Object.keys(blocks[role]).sort()).toEqual([...CAPABILITY_KEYS].sort());
  });

  it("con los mismos valores por rol", () => {
    for (const role of EDITABLE_ROLES) {
      for (const key of CAPABILITY_KEYS) expect([role, key, blocks[role][key]]).toEqual([role, key, CAPABILITIES[key].defaults[role]]);
    }
  });
});
