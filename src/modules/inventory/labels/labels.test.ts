import { describe, expect, it } from "vitest";
import { expandLabels, labelsHtml } from "./labels";

describe("etiquetas", () => {
  it("repite cada producto según las copias, con tope", () => {
    expect(expandLabels([{ item: "a", copies: 2 }, { item: "b", copies: 0 }, { item: "c", copies: 1.7 }])).toEqual(["a", "a", "c"]);
    expect(expandLabels([{ item: "a", copies: 10 }], 3)).toHaveLength(3);
  });

  it("arma la hoja: rollo una por página, carta en grilla; escapa texto", () => {
    const item = { name: "Filtro <Toyota>", detail: "Corolla", code: "759001", price: "$ 9,00", priceLocal: "Bs. 7.920,00", barcodeSvg: "<svg></svg>" };
    const thermal = labelsHtml([item], "thermal");
    expect(thermal).toContain("size: 50mm 25mm");
    expect(thermal).toContain("Filtro &lt;Toyota&gt;");
    expect(thermal).toContain("<svg></svg>");
    expect(thermal).toContain("Bs. 7.920,00");
    expect(labelsHtml([item], "sheet")).toContain('<div class="sheet">');
  });
});
