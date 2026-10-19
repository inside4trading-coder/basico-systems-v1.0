import planLimitsSql from "../../supabase/migrations/20261104000000_plan_limits.sql?raw";
import { ENTITLEMENT_DEFAULTS, resolveEntitlements } from "./entitlements";

const NOW = new Date("2026-10-19T12:00:00Z");

describe("resolveEntitlements", () => {
  it("sin filas devuelve los defaults", () => {
    expect(resolveEntitlements([], NOW)).toEqual(ENTITLEMENT_DEFAULTS);
  });

  it("una excepción vigente gana al default", () => {
    const result = resolveEntitlements(
      [
        { key: "estudio", value: true, expires_at: null },
        { key: "max_locations", value: 3, expires_at: "2027-01-01T00:00:00Z" },
      ],
      NOW,
    );
    expect(result.estudio).toBe(true);
    expect(result.max_locations).toBe(3);
  });

  it("una excepción vencida no aplica", () => {
    const result = resolveEntitlements([{ key: "estudio", value: true, expires_at: "2026-10-01T00:00:00Z" }], NOW);
    expect(result.estudio).toBe(false);
  });

  it("ignora claves desconocidas y valores con tipo equivocado", () => {
    const result = resolveEntitlements(
      [
        { key: "no_existe", value: true, expires_at: null },
        { key: "max_users", value: "99", expires_at: null },
      ],
      NOW,
    );
    expect(result).toEqual(ENTITLEMENT_DEFAULTS);
  });
});

describe("defaults en la base", () => {
  it("app.entitlement_defaults() coincide con ENTITLEMENT_DEFAULTS", () => {
    const body = /jsonb_build_object\(([\s\S]*?)\)\s*\$\$/.exec(planLimitsSql)?.[1] ?? "";
    const pairs = [...body.matchAll(/'([a-z_]+)',\s*(true|false|\d+)/g)];
    const sqlDefaults = Object.fromEntries(pairs.map(([, key, value]) => [key, /^\d+$/.test(value) ? Number(value) : value === "true"]));
    expect(sqlDefaults).toEqual(ENTITLEMENT_DEFAULTS);
  });
});
