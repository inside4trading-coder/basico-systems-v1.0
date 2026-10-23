/** Cómo se compara el envío con la ficha de clientes. */
import type { Customer } from "@/modules/customers/api";
import { docKey, type DeliveryData } from "./parse";

export const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/** Misma cédula: iguales letra y número, o solo el número si a una le falta la letra. */
export function sameDoc(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = digits(a);
  if (da.length < 6 || da !== digits(b)) return false;
  const la = docKey(a ?? "").replace(/\d/g, "");
  const lb = docKey(b ?? "").replace(/\d/g, "");
  return !la || !lb || la === lb;
}

/** Lo que el envío puede agregar a la ficha sin pisar nada. */
export function profileAdditions(c: Customer, d: DeliveryData): { phone?: string; address?: string; doc?: string } {
  const add: { phone?: string; address?: string; doc?: string } = {};
  if (!c.phone?.trim() && d.phone.trim()) add.phone = d.phone.trim();
  if (!c.address?.trim() && d.address.trim()) {
    add.address = [d.address, d.municipality && `Municipio ${d.municipality}`, d.state].filter(Boolean).join(", ");
  }
  if (!c.doc?.trim() && d.doc.trim()) add.doc = d.doc.trim();
  return add;
}
