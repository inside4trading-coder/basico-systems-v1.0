import { describe, expect, it } from "vitest";
import { assignableRoles, canEditMember, teamErrorMessage } from "./team";

const me = "u-1";

describe("canEditMember", () => {
  it("nadie se edita a sí mismo", () => {
    expect(canEditMember("owner", me, { user_id: me, role: "owner" })).toBe(false);
  });

  it("el owner edita a cualquiera, incluso a otro owner", () => {
    expect(canEditMember("owner", me, { user_id: "u-2", role: "owner" })).toBe(true);
    expect(canEditMember("owner", me, { user_id: "u-2", role: "cajero" })).toBe(true);
  });

  it("el admin edita a todos menos al owner", () => {
    expect(canEditMember("admin", me, { user_id: "u-2", role: "manager" })).toBe(true);
    expect(canEditMember("admin", me, { user_id: "u-2", role: "owner" })).toBe(false);
  });

  it("encargado y cajero no gestionan el equipo", () => {
    expect(canEditMember("manager", me, { user_id: "u-2", role: "cajero" })).toBe(false);
    expect(canEditMember(undefined, me, { user_id: "u-2", role: "cajero" })).toBe(false);
  });
});

describe("assignableRoles", () => {
  it("solo un owner nombra owners", () => {
    expect(assignableRoles("owner")).toContain("owner");
    expect(assignableRoles("admin")).not.toContain("owner");
  });
});

describe("teamErrorMessage", () => {
  it("traduce los errores de la base", () => {
    expect(teamErrorMessage("El tenant x se quedaría sin owner")).toBe("El negocio necesita al menos un dueño.");
    expect(teamErrorMessage("new row violates row-level security policy")).toMatch(/permiso/);
    expect(teamErrorMessage("")).toBe("No se pudo guardar el cambio.");
  });
});
