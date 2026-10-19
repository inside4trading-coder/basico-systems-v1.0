import { normalizeHeader, suggestMapping, type ColumnMapping } from "./fields";
import { buildPreview, parseAmount, parseYesNo, type ImportContext } from "./preview";

describe("parseAmount", () => {
  it.each([
    ["30", 30],
    ["12,5", 12.5],
    ["1.234,56", 1234.56],
    ["1,234.56", 1234.56],
    ["1.500", 1500],
    ["12.345.678", 12345678],
    ["$ 30", 30],
    ["Bs. 1.500,25", 1500.25],
    ["0.75", 0.75],
  ])("lee %s", (text, expected) => {
    expect(parseAmount(text)).toBeCloseTo(expected);
  });

  it("vacío es null y basura es NaN", () => {
    expect(parseAmount("  ")).toBeNull();
    expect(parseAmount("abc")).toBeNaN();
  });
});

describe("parseYesNo", () => {
  it("entiende sí/no en español", () => {
    expect(parseYesNo("Sí")).toBe(true);
    expect(parseYesNo("no")).toBe(false);
    expect(parseYesNo("")).toBeNull();
    expect(parseYesNo("quizás")).toBe("invalid");
  });
});

describe("suggestMapping", () => {
  const ctx = {
    locationCodes: ["T1", "AL"],
    defaultLocationCode: "T1",
    attributes: [{ key: "vehiculo", label: "Vehículo compatible" }],
  };

  it("normaliza acentos y signos", () => {
    expect(normalizeHeader("Código de Barras ")).toBe("codigo de barras");
  });

  it("reconoce columnas típicas de un Excel de repuestos", () => {
    const mapping = suggestMapping(
      ["Descripción", "Referencia", "Nro. Parte", "Marca", "PVP", "Costo", "Existencia", "AL", "Vehículo compatible", "Observaciones"],
      ctx,
    );
    expect(mapping).toEqual({
      Descripción: "name",
      Referencia: "sku",
      "Nro. Parte": "code:oem",
      Marca: "brand",
      PVP: "regular_price",
      Costo: "cost",
      Existencia: "stock:T1",
      AL: "stock:AL",
      "Vehículo compatible": "attr:vehiculo",
      Observaciones: "",
    });
  });

  it("una columna con el código de la sede gana sobre 'Existencia'", () => {
    const mapping = suggestMapping(["Existencia", "T1"], ctx);
    expect(mapping).toEqual({ Existencia: "", T1: "stock:T1" });
  });

  it("reconoce los encabezados que escribe la exportación", () => {
    const mapping = suggestMapping(["Número de parte / OEM", "Código de barras", "Existencia AL"], ctx);
    expect(mapping).toEqual({ "Número de parte / OEM": "code:oem", "Código de barras": "code:barcode", "Existencia AL": "stock:AL" });
  });

  it("no asigna dos columnas al mismo campo", () => {
    const mapping = suggestMapping(["Precio", "PVP"], ctx);
    expect(Object.values(mapping).filter((f) => f === "regular_price")).toHaveLength(1);
  });
});

describe("buildPreview", () => {
  const ctx: ImportContext = {
    catalog: [
      {
        variantId: "v1",
        productId: "p1",
        sku: "PF-001",
        codes: [{ kind: "oem", code: "04465-0K290" }],
        stockByLocationCode: { T1: 10 },
      },
    ],
    locationCodes: ["T1", "AL"],
    attributes: [{ key: "vehiculo", multi: true }],
  };
  const mapping: ColumnMapping = {
    Nombre: "name",
    SKU: "sku",
    OEM: "code:oem",
    Talla: "option:Talla",
    Precio: "regular_price",
    Stock: "stock:T1",
    Vehículo: "attr:vehiculo",
  };

  it("decide crear o actualizar y arma solo lo que trae valor", () => {
    const { preview, summary } = buildPreview(
      [
        { Nombre: "Pastillas", SKU: "pf-001", OEM: "", Talla: "", Precio: "27", Stock: "4", Vehículo: "" },
        { Nombre: "Filtro de aceite", SKU: "FA-9", OEM: "15601-44011", Talla: "", Precio: "8,5", Stock: "", Vehículo: "Hilux 2010; Fortuner 2012" },
      ],
      mapping,
      ctx,
    );
    expect(preview.map((r) => r.action)).toEqual(["Actualizar", "Crear"]);
    expect(preview[0].payload.variant).toEqual({ regular_price: 27 });
    expect(preview[0].warnings[0]).toContain("cambia mucho");
    expect(preview[1].payload.attributes).toEqual([
      { key: "vehiculo", value: "Hilux 2010" },
      { key: "vehiculo", value: "Fortuner 2012" },
    ]);
    expect(preview[1].payload.stock).toEqual([]);
    expect(summary).toMatchObject({ total: 2, valid: 2, productsCreate: 1, variantsCreate: 1, variantsUpdate: 1, stockRows: 1 });
  });

  it("empareja por código cuando no hay SKU", () => {
    const { preview } = buildPreview([{ Nombre: "", SKU: "", OEM: "04465-0k290", Precio: "30" }], mapping, ctx);
    expect(preview[0].action).toBe("Actualizar");
  });

  it("bloquea un SKU nuevo que trae un código ajeno", () => {
    const { preview } = buildPreview([{ Nombre: "Otro", SKU: "NUEVO", OEM: "04465-0K290" }], mapping, ctx);
    expect(preview[0].action).toBe("Bloqueada");
    expect(preview[0].errors[0]).toContain("ya es de otro producto");
  });

  it("bloquea filas sin forma de identificarlas, sin nombre o con montos malos", () => {
    const { preview } = buildPreview(
      [
        { Nombre: "Sin código", SKU: "", OEM: "" },
        { Nombre: "", SKU: "NUEVO-2" },
        { Nombre: "Precio raro", SKU: "X1", Precio: "treinta" },
        { Nombre: "Stock negativo", SKU: "X2", Stock: "-1" },
      ],
      mapping,
      ctx,
    );
    expect(preview.every((r) => r.action === "Bloqueada")).toBe(true);
  });

  it("detecta SKU repetido y variantes iguales dentro del archivo", () => {
    const { preview } = buildPreview(
      [
        { Nombre: "Franela", SKU: "FR-M", Talla: "M" },
        { Nombre: "Franela", SKU: "FR-M2", Talla: "M" },
        { Nombre: "Gorra", SKU: "GO-1" },
        { Nombre: "Gorra", SKU: "GO-1" },
      ],
      mapping,
      ctx,
    );
    expect(preview[1].errors[0]).toContain("Repite las mismas opciones");
    expect(preview[2].errors.some((e) => e.includes("SKU repetido"))).toBe(true);
    expect(preview[3].errors.some((e) => e.includes("SKU repetido"))).toBe(true);
  });

  it("agrupa tallas del mismo producto", () => {
    const { summary } = buildPreview(
      [
        { Nombre: "Franela", SKU: "FR-M", Talla: "M", Precio: "10" },
        { Nombre: "Franela", SKU: "FR-L", Talla: "L", Precio: "10" },
      ],
      mapping,
      ctx,
    );
    expect(summary).toMatchObject({ productsCreate: 1, variantsCreate: 2, blocked: 0 });
  });
});
