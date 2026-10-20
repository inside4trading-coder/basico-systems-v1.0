import { describe, expect, it } from "vitest";
import { saleCustomer } from "./lib";

describe("cliente de la venta", () => {
  it("vacío no manda cliente", () => {
    expect(saleCustomer({})).toBeNull();
    expect(saleCustomer({ name: "  ", doc: "", phone: " " })).toBeNull();
  });

  it("elegido de la ficha manda el id", () => {
    expect(saleCustomer({ id: "c1", name: "Taller", doc: "J-1", phone: "0414" })).toEqual({ id: "c1", name: "Taller", doc: "J-1" });
  });

  it("escrito a mano limpia espacios y omite lo vacío", () => {
    expect(saleCustomer({ name: " Ana ", doc: "", phone: "0414 555 1234 " })).toEqual({ name: "Ana", doc: undefined, phone: "0414 555 1234" });
  });
});
