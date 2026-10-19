import { canManageTeam, pickInitialTenant, type Membership } from "./tenant-selection";

const m = (id: string, role: Membership["role"] = "owner"): Membership => ({
  role,
  tenant: { id, name: `Tienda ${id}`, slug: `tienda-${id}`, status: "active" },
});

describe("pickInitialTenant", () => {
  it("sin membresías no hay tenant", () => {
    expect(pickInitialTenant([], null)).toBeNull();
  });

  it("con una sola membresía la elige", () => {
    expect(pickInitialTenant([m("a")], null)).toBe("a");
  });

  it("recuerda el último tenant si sigue siendo miembro", () => {
    expect(pickInitialTenant([m("a"), m("b")], "b")).toBe("b");
  });

  it("descarta un tenant recordado del que ya no es miembro", () => {
    expect(pickInitialTenant([m("a"), m("b")], "c")).toBeNull();
    expect(pickInitialTenant([m("a")], "c")).toBe("a");
  });

  it("con varios y sin recuerdo deja elegir", () => {
    expect(pickInitialTenant([m("a"), m("b")], null)).toBeNull();
  });
});

describe("canManageTeam", () => {
  it("solo owner y admin gestionan el equipo", () => {
    expect(canManageTeam("owner")).toBe(true);
    expect(canManageTeam("admin")).toBe(true);
    expect(canManageTeam("manager")).toBe(false);
    expect(canManageTeam("cajero")).toBe(false);
    expect(canManageTeam(undefined)).toBe(false);
  });
});
