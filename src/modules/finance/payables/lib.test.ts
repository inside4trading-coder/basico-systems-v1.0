import { describe, expect, it } from "vitest";
import type { Payable } from "./api";
import {
  addDays,
  dueLabel,
  isPayableDueSoon,
  isPayableOverdue,
  matchesPayableFilter,
  matchesPayableSearch,
  nextPayableDue,
  payableInstallmentState,
  payableLeft,
} from "./lib";

const today = "2026-11-13";

function payable(over: Partial<Payable> = {}): Payable {
  return {
    id: "p1",
    supplier_id: "s1",
    supplier: { name: "Proveedor X", tax_id: "J-12345678-9" },
    document: "F-100",
    control_number: null,
    issued_on: "2026-11-01",
    currency: "USD",
    subtotal: 100,
    tax_amount: 16,
    amount: 116,
    paid: 0,
    category: "Proveedores",
    status: "open",
    cancel_reason: null,
    note: null,
    source: "manual",
    proof_paths: [],
    installments: [{ id: "i1", payable_id: "p1", number: 1, due_date: "2026-11-20", amount: 116, paid: 0 }],
    ...over,
  };
}

describe("cuotas por pagar", () => {
  it("estado de cada cuota", () => {
    expect(payableInstallmentState({ due_date: "2026-11-01", amount: 50, paid: 50 }, today)).toBe("paid");
    expect(payableInstallmentState({ due_date: "2026-11-01", amount: 50, paid: 10 }, today)).toBe("overdue");
    expect(payableInstallmentState({ due_date: "2026-11-30", amount: 50, paid: 10 }, today)).toBe("partial");
    expect(payableInstallmentState({ due_date: "2026-11-30", amount: 50, paid: 0 }, today)).toBe("pending");
  });

  it("la próxima cuota es la más vieja con saldo", () => {
    const next = nextPayableDue([
      { due_date: "2026-12-01", amount: 10, paid: 0 },
      { due_date: "2026-11-01", amount: 10, paid: 10 },
      { due_date: "2026-11-15", amount: 10, paid: 2 },
    ]);
    expect(next?.due_date).toBe("2026-11-15");
  });

  it("saldo: solo de las abiertas", () => {
    expect(payableLeft(payable({ paid: 16.1 }))).toBe(99.9);
    expect(payableLeft(payable({ status: "cancelled" }))).toBe(0);
  });
});

describe("filtros", () => {
  const overdue = payable({ installments: [{ id: "i", payable_id: "p1", number: 1, due_date: "2026-11-10", amount: 116, paid: 0 }] });
  const soon = payable({ installments: [{ id: "i", payable_id: "p1", number: 1, due_date: "2026-11-18", amount: 116, paid: 0 }] });
  const later = payable({ installments: [{ id: "i", payable_id: "p1", number: 1, due_date: "2026-12-30", amount: 116, paid: 0 }] });

  it("vencida y por vencer no se mezclan", () => {
    expect(isPayableOverdue(overdue, today)).toBe(true);
    expect(isPayableDueSoon(overdue, today)).toBe(false);
    expect(isPayableDueSoon(soon, today)).toBe(true);
    expect(isPayableDueSoon(later, today)).toBe(false);
  });

  it("filtra por estado", () => {
    expect(matchesPayableFilter(overdue, "overdue", today)).toBe(true);
    expect(matchesPayableFilter(soon, "due_soon", today)).toBe(true);
    expect(matchesPayableFilter(payable({ status: "paid" }), "open", today)).toBe(false);
    expect(matchesPayableFilter(payable({ status: "paid" }), "all", today)).toBe(true);
  });

  it("busca por proveedor, RIF o factura", () => {
    expect(matchesPayableSearch(payable(), "proveedor x")).toBe(true);
    expect(matchesPayableSearch(payable(), "12345678")).toBe(true);
    expect(matchesPayableSearch(payable(), "f-100")).toBe(true);
    expect(matchesPayableSearch(payable(), "otro")).toBe(false);
  });
});

describe("textos de vencimiento", () => {
  it("dice cuánto falta o cuánto lleva vencida", () => {
    expect(dueLabel("2026-11-12", today)).toBe("Vencida hace 1 día");
    expect(dueLabel("2026-11-08", today)).toBe("Vencida hace 5 días");
    expect(dueLabel("2026-11-13", today)).toBe("Vence hoy");
    expect(dueLabel("2026-11-14", today)).toBe("Vence en 1 día");
    expect(addDays("2026-11-25", 15)).toBe("2026-12-10");
  });
});
