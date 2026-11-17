import { safeLinks } from "./guides";

describe("botones de [B]eto", () => {
  it("solo deja pasar rutas de las guías, máximo 2", () => {
    const links = safeLinks([
      { type: "kpi", label: "Ventas", value: "1" },
      { type: "link", label: "Ir a Por pagar", to: "/administracion?tab=payables" },
      { type: "link", label: "Malo", to: "https://malo.example" },
      { type: "link", label: "Ir a Recepción", to: "/control?tab=recepcion" },
      { type: "link", label: "Ir a Precios", to: "/inventario/precios" },
    ]);
    expect(links.map((l) => l.to)).toEqual(["/administracion?tab=payables", "/control?tab=recepcion"]);
    expect(safeLinks(null)).toEqual([]);
  });
});
