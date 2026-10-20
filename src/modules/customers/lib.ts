import type { SaleCustomer } from "./api";

/** Lo que se manda a la venta: null si no se escribió nada. */
export function saleCustomer(value: SaleCustomer): SaleCustomer | null {
  if (value.id) return { id: value.id, name: value.name, doc: value.doc };
  const name = value.name?.trim();
  const doc = value.doc?.trim();
  const phone = value.phone?.trim();
  if (!name && !doc && !phone) return null;
  return { name: name || undefined, doc: doc || undefined, phone: phone || undefined };
}
