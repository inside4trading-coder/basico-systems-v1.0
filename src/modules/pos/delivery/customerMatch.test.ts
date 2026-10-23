import { describe, expect, it } from "vitest";
import type { Customer } from "@/modules/customers/api";
import { profileAdditions, sameDoc } from "./customerMatch";
import { EMPTY_DELIVERY } from "./parse";

const customer = (over: Partial<Customer>): Customer => ({
  id: "c1", name: "Ana Pérez", doc: null, phone: null, email: null, address: null, notes: null,
  created_at: "2026-01-01", purchases: 0, total: 0, last_purchase: null, ...over,
});

describe("sameDoc", () => {
  it("compara por número y letra", () => {
    expect(sameDoc("V-12.345.678", "v12345678")).toBe(true);
    expect(sameDoc("12345678", "V-12345678")).toBe(true);
    expect(sameDoc("E-12345678", "V-12345678")).toBe(false);
    expect(sameDoc("V-1234", "V-1234")).toBe(false);
  });
});

describe("profileAdditions", () => {
  it("solo propone lo que la ficha no tiene", () => {
    const d = { ...EMPTY_DELIVERY, phone: "0414-1234567", address: "Calle 1", municipality: "Iribarren", state: "Lara", doc: "V-1" };
    expect(profileAdditions(customer({ phone: "0412-0000000", doc: "V-1" }), d)).toEqual({
      address: "Calle 1, Municipio Iribarren, Lara",
    });
    expect(profileAdditions(customer({ phone: "x", address: "y", doc: "z" }), d)).toEqual({});
  });
});
