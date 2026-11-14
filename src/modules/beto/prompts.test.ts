import { allowedPrompt, promptLibrary, SUGGESTIONS } from "./prompts";

describe("prompts de Beto", () => {
  it("sin permisos de reportes ni finanzas no queda ninguna sugerencia", () => {
    const none = { reportes: false, finanzas: false };
    expect(SUGGESTIONS.filter((s) => allowedPrompt(s, none))).toEqual([]);
    expect(promptLibrary(none)).toEqual([]);
  });

  it("con reportes pero sin finanzas, oculta las preguntas de dinero", () => {
    const access = { reportes: true, finanzas: false };
    expect(SUGGESTIONS.filter((s) => allowedPrompt(s, access)).map((s) => s.icon)).toEqual(["box", "cart"]);
    const areas = promptLibrary(access).map((g) => g.area);
    expect(areas).toEqual(["Ventas", "Inventario", "Clientes"]);
  });

  it("con todo, las 4 sugerencias de la tarjeta", () => {
    expect(SUGGESTIONS.filter((s) => allowedPrompt(s, { reportes: true, finanzas: true }))).toHaveLength(4);
  });
});
