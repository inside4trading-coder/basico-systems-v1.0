import { getActiveTenantId, setActiveTenantId } from "./tenant";

describe("tenant activo", () => {
  afterEach(() => setActiveTenantId(null));

  it("guarda y devuelve el tenant elegido", () => {
    setActiveTenantId("t-1");
    expect(getActiveTenantId()).toBe("t-1");
    expect(localStorage.getItem("bsys.activeTenantId")).toBe("t-1");
  });

  it("al limpiar no deja rastro en localStorage", () => {
    setActiveTenantId("t-1");
    setActiveTenantId(null);
    expect(getActiveTenantId()).toBeNull();
    expect(localStorage.getItem("bsys.activeTenantId")).toBeNull();
  });
});
