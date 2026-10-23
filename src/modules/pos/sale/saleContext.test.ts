import { describe, expect, it } from "vitest";
import type { SalesChannel } from "@/modules/settings/api";
import { EMPTY_DELIVERY } from "../delivery/parse";
import { pickChannel, posChannels, saleContextProblem, saleSummary } from "./saleContext";

const ch = (name: string, position: number, requires = false, is_active = true): SalesChannel => ({
  id: name.toLowerCase(),
  name,
  position,
  is_active,
  requires_fulfillment: requires,
});

const full = {
  first_name: "Ana", last_name: "Pérez", phone: "0414-1234567", doc: "V-1234567", address: "Calle 1, casa 2",
  municipality: "Iribarren", state: "Lara", carrier: "MRW" as const,
};

describe("posChannels", () => {
  it("ordena, oculta inactivos y nunca muestra Web", () => {
    const list = posChannels([ch("Cashea", 4, true), ch("Web", 0), ch("Tienda física", 1), ch("Delivery", 5, true, false), ch("WhatsApp", 2, true)]);
    expect(list.map((c) => c.name)).toEqual(["Tienda física", "WhatsApp", "Cashea"]);
  });
});

describe("saleContextProblem", () => {
  it("sin origen no se vende", () => {
    expect(saleContextProblem(null)).toMatch(/origen/);
  });
  it("los orígenes a distancia piden modalidad", () => {
    expect(saleContextProblem(pickChannel(null, ch("WhatsApp", 2, true), null))).toMatch(/retirar o para enviar/);
    expect(saleContextProblem(pickChannel(null, ch("WhatsApp", 2, true), "pickup"))).toBeNull();
  });
  it("la tienda física no lleva modalidad", () => {
    const ctx = pickChannel(null, ch("Tienda física", 1), "envio");
    expect(ctx.fulfillment).toBeNull();
    expect(saleContextProblem(ctx)).toBeNull();
  });
  it("el envío pide todos los campos", () => {
    const ctx = pickChannel(null, ch("Instagram", 3, true), "envio");
    expect(saleContextProblem(ctx)).toMatch(/Nombre, Apellido/);
    expect(saleContextProblem({ ...ctx, delivery: { ...EMPTY_DELIVERY, ...full, state: "" } })).toBe("Completa los datos del envío: Estado.");
    expect(saleContextProblem({ ...ctx, delivery: full })).toBeNull();
  });
});

describe("saleSummary y cambios", () => {
  it("resume origen, modalidad y empresa", () => {
    const ctx = { ...pickChannel(null, ch("WhatsApp", 2, true), "envio"), delivery: full };
    expect(saleSummary(ctx)).toBe("WhatsApp · Envío · MRW");
    expect(saleSummary(pickChannel(null, ch("Tienda física", 1), null))).toBe("Tienda física");
  });
  it("al cambiar de origen conserva el envío y el cliente si sigue siendo envío", () => {
    const prev = { ...pickChannel(null, ch("WhatsApp", 2, true), "envio"), delivery: full, customer: { id: "c1" } };
    const next = pickChannel(prev, ch("Cashea", 4, true), "envio");
    expect(next.delivery).toEqual(full);
    expect(next.customer).toEqual({ id: "c1" });
    expect(pickChannel(prev, ch("Cashea", 4, true), "pickup").delivery).toBeNull();
  });
});
