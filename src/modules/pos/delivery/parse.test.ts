import { describe, expect, it } from "vitest";
import { deliveryProblems, docKey, normalizeDoc, normalizePhone, parseDeliveryText, splitName } from "./parse";

describe("parseDeliveryText", () => {
  it("lee un mensaje con etiquetas", () => {
    const r = parseDeliveryText(`*Nombre:* Ana
Apellido: Pérez
Cédula: V-12.345.678
Teléfono: 0414 123 4567
Dirección: Calle 5 entre 10 y 11, casa 20
Municipio: Iribarren
Estado: Lara
Envío por: MRW`);
    expect(r.data).toEqual({
      first_name: "Ana",
      last_name: "Pérez",
      doc: "V-12345678",
      phone: "0414-1234567",
      address: "Calle 5 entre 10 y 11, casa 20",
      municipality: "Iribarren",
      state: "Lara",
      carrier: "MRW",
    });
    expect(r.missing).toEqual([]);
    expect(r.review).toEqual([]);
  });

  it("lee un mensaje desordenado sin etiquetas", () => {
    const r = parseDeliveryText(`Buenas!
Carlos Gómez
v 20111222
+58 424-555.12.34
Av. Bolívar, Edif. Sol, piso 3, apto 3B, Municipio Libertador
Distrito Capital
zoom`);
    expect(r.data.first_name).toBe("Carlos");
    expect(r.data.last_name).toBe("Gómez");
    expect(r.data.doc).toBe("V-20111222");
    expect(r.data.phone).toBe("0424-5551234");
    expect(r.data.address).toBe("Av. Bolívar, Edif. Sol, piso 3, apto 3B");
    expect(r.data.municipality).toBe("Libertador");
    expect(r.data.state).toBe("Distrito Capital");
    expect(r.data.carrier).toBe("Zoom");
  });

  it("no inventa lo que falta", () => {
    const r = parseDeliveryText("Nombre y apellido: Luis Mora\nTelf 04121112233");
    expect(r.data.municipality).toBe("");
    expect(r.data.state).toBe("");
    expect(r.data.carrier).toBe("");
    expect(r.missing).toEqual(["doc", "address", "municipality", "state", "carrier"]);
  });

  it("marca lo ambiguo", () => {
    const r = parseDeliveryText("Nombre completo: María José Rivas\nCédula: 15.222.333\nAgencia: MRW o Zoom");
    expect(r.data.first_name).toBe("María");
    expect(r.data.last_name).toBe("José Rivas");
    expect(r.data.doc).toBe("15222333");
    expect(r.data.carrier).toBe("");
    expect(r.review.map((x) => x.field).sort()).toEqual(["carrier", "doc", "first_name", "last_name"]);
  });

  it("rechaza empresas que no trabajamos", () => {
    const r = parseDeliveryText("Empresa: Tealca");
    expect(r.data.carrier).toBe("");
    expect(r.review[0].field).toBe("carrier");
  });

  it("reconoce el estado con o sin acento y con prefijo", () => {
    expect(parseDeliveryText("Estado: tachira").data.state).toBe("Táchira");
    expect(parseDeliveryText("Edo. Mérida").data.state).toBe("Mérida");
  });
});

describe("helpers", () => {
  it("normaliza teléfonos", () => {
    expect(normalizePhone("+58 414 1234567")).toBe("0414-1234567");
    expect(normalizePhone("4161234567")).toBe("0416-1234567");
    expect(normalizePhone("1234")).toBeNull();
  });
  it("normaliza cédulas y RIF", () => {
    expect(normalizeDoc("e-8.123.456")).toEqual({ doc: "E-8123456", hasLetter: true });
    expect(normalizeDoc("J-40123456-7")).toEqual({ doc: "J-40123456-7", hasLetter: true });
    expect(normalizeDoc("12")).toBeNull();
  });
  it("divide nombres", () => {
    expect(splitName("Ana María Pérez Gómez")).toEqual({ first: "Ana María", last: "Pérez Gómez", ambiguous: false });
    expect(splitName("Ana Pérez Gómez").ambiguous).toBe(true);
  });
  it("valida el envío", () => {
    expect(
      deliveryProblems({
        first_name: "A", last_name: "B", phone: "0414-1234567", doc: "V-1234567", address: "Calle 1",
        municipality: "M", state: "Lara", carrier: "MRW",
      }),
    ).toEqual([]);
    expect(
      deliveryProblems({
        first_name: "", last_name: "B", phone: "12", doc: "V-1", address: "x", municipality: "", state: "Lara", carrier: "",
      }),
    ).toEqual(["first_name", "phone", "doc", "municipality", "carrier"]);
  });
  it("compara cédulas como la base", () => {
    expect(docKey("v-12.345.678")).toBe("V12345678");
  });
});
