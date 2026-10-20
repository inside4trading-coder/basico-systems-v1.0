import { describe, expect, it } from "vitest";
import type { RegisterSaleInput, RegisterSaleResult, SaleReceipt } from "../api";
import { receiptHtml } from "../receipt";
import { applyLocalSale, localLookup, type SnapshotRow } from "./catalog";
import { memoryStore } from "./kv";
import { buildLocalReceipt } from "./localReceipt";
import { discardSale, enqueueSale, loadQueue, provisionalNumber, retrySale, syncQueue, type QueuedSale } from "./queue";
import { isNetworkError } from "@/core/offline";

const T = "tenant-a";

function queued(key: string, soldAt: string, sessionId = "s1"): QueuedSale {
  const input: RegisterSaleInput = { idempotencyKey: key, sessionId, items: [{ variant_id: "v1", qty: 1 }], payments: [], soldAt };
  return { key, sessionId, soldAt, input, receipt: {} as SaleReceipt, status: "pending", attempts: 0, error: null };
}

const ok = (input: RegisterSaleInput): Promise<RegisterSaleResult> =>
  Promise.resolve({ sale_id: `id-${input.idempotencyKey}`, number: `V-${input.idempotencyKey}`, total: 10, igtf: 0, rate: 40, duplicate: false });

describe("cola de ventas sin conexión", () => {
  it("no encola dos veces la misma venta", async () => {
    const store = memoryStore();
    await enqueueSale(store, T, queued("a", "2026-10-19T10:00:00Z"));
    await enqueueSale(store, T, queued("a", "2026-10-19T10:00:00Z"));
    expect(await loadQueue(store, T)).toHaveLength(1);
  });

  it("sincroniza en el orden en que se cobró y vacía la cola", async () => {
    const store = memoryStore();
    await enqueueSale(store, T, queued("b", "2026-10-19T10:05:00Z"));
    await enqueueSale(store, T, queued("a", "2026-10-19T10:00:00Z"));
    const sent: string[] = [];
    const out = await syncQueue(store, T, (input) => {
      sent.push(input.idempotencyKey);
      return ok(input);
    });
    expect(sent).toEqual(["a", "b"]);
    expect(out.synced.map((s) => s.result.number)).toEqual(["V-a", "V-b"]);
    expect(await loadQueue(store, T)).toEqual([]);
  });

  it("si se corta la red a mitad, deja el resto pendiente", async () => {
    const store = memoryStore();
    await enqueueSale(store, T, queued("a", "2026-10-19T10:00:00Z"));
    await enqueueSale(store, T, queued("b", "2026-10-19T10:05:00Z"));
    const out = await syncQueue(store, T, (input) => (input.idempotencyKey === "a" ? ok(input) : Promise.reject(new TypeError("Failed to fetch"))));
    expect(out.interrupted).toBe(true);
    const rest = await loadQueue(store, T);
    expect(rest.map((x) => [x.key, x.status, x.attempts])).toEqual([["b", "pending", 1]]);
  });

  it("un rechazo del servidor queda para revisión y no frena las demás", async () => {
    const store = memoryStore();
    await enqueueSale(store, T, queued("a", "2026-10-19T10:00:00Z"));
    await enqueueSale(store, T, queued("b", "2026-10-19T10:05:00Z"));
    const out = await syncQueue(store, T, (input) =>
      input.idempotencyKey === "a" ? Promise.reject(new Error("Stock insuficiente de Filtro: hay 0")) : ok(input),
    );
    expect(out.failed.map((f) => f.error)).toEqual(["Stock insuficiente de Filtro: hay 0"]);
    expect(out.synced).toHaveLength(1);
    const rest = await loadQueue(store, T);
    expect(rest.map((x) => [x.key, x.status])).toEqual([["a", "failed"]]);

    // Una venta rechazada no se reintenta sola.
    let calls = 0;
    await syncQueue(store, T, (input) => {
      calls++;
      return ok(input);
    });
    expect(calls).toBe(0);

    await retrySale(store, T, "a");
    await syncQueue(store, T, ok);
    expect(await loadQueue(store, T)).toEqual([]);
  });

  it("descartar quita la venta de la cola", async () => {
    const store = memoryStore();
    await enqueueSale(store, T, queued("a", "2026-10-19T10:00:00Z"));
    await discardSale(store, T, "a");
    expect(await loadQueue(store, T)).toEqual([]);
  });

  it("cada negocio tiene su propia cola", async () => {
    const store = memoryStore();
    await enqueueSale(store, T, queued("a", "2026-10-19T10:00:00Z"));
    expect(await loadQueue(store, "tenant-b")).toEqual([]);
  });

  it("reconoce cortes de red y no confunde rechazos del servidor", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError({ message: "TypeError: NetworkError when attempting to fetch resource." })).toBe(true);
    expect(isNetworkError(new Error("Stock insuficiente de Filtro: hay 0"))).toBe(false);
  });

  it("número provisional corto y legible", () => {
    expect(provisionalNumber("3f2a9c1e-77aa-4bbb-8ccc-123456789abc")).toBe("PEND-3F2A9C");
  });
});

const rows: SnapshotRow[] = [
  { variant_id: "v1", product_id: "p1", product_name: "Filtro de aceite", options: {}, brand: "Toyota", sku: "FA-90915", price: 8.5, unit: "unidad", tax_rate: 16, available: 3, codes: ["90915-YZZD2"], search: "filtro de aceite toyota filtros fa-90915" },
  { variant_id: "v2", product_id: "p2", product_name: "Aceite 15W40", options: { Presentación: "Granel" }, brand: "Castrol", sku: "AC-15W40", price: 6.75, unit: "litro", tax_rate: 8, available: 40, codes: [], search: "aceite 15w40 castrol lubricantes ac-15w40 granel" },
];

describe("catálogo sin conexión", () => {
  it("SKU exacto antes que texto", () => {
    expect(localLookup(rows, "fa-90915").map((h) => [h.variant_id, h.match_kind])).toEqual([["v1", "sku"]]);
  });

  it("código del fabricante exacto", () => {
    expect(localLookup(rows, "90915-yzzd2").map((h) => [h.variant_id, h.match_kind])).toEqual([["v1", "codigo"]]);
  });

  it("todas las palabras en cualquier orden", () => {
    expect(localLookup(rows, "castrol aceite").map((h) => h.variant_id)).toEqual(["v2"]);
    expect(localLookup(rows, "aceite").map((h) => h.variant_id)).toEqual(["v1", "v2"]);
    expect(localLookup(rows, "aceite bosch")).toEqual([]);
  });

  it("sin tildes ni mayúsculas", () => {
    expect(localLookup(rows, "lubricántes").map((h) => h.variant_id)).toEqual(["v2"]);
  });

  it("descuenta lo vendido sin conexión del disponible local", () => {
    const after = applyLocalSale({ locationId: "l1", fetchedAt: "", rows }, [
      { variant_id: "v1", qty: 2 },
      { variant_id: "v1", qty: 5 },
    ]);
    expect(after.rows.find((r) => r.variant_id === "v1")?.available).toBe(0);
    expect(after.rows.find((r) => r.variant_id === "v2")?.available).toBe(40);
  });
});

describe("nota provisional", () => {
  it("cuadra con el carrito y se imprime como sin conexión", () => {
    const money = { baseCurrency: "USD", localCurrency: "VES", rate: 200, isSpecialTaxpayer: false, igtfRate: 3 };
    const receipt = buildLocalReceipt({
      key: "abcdef12-0000",
      soldAt: "2026-10-19T14:00:00Z",
      lines: [{ variantId: "v1", productId: "p1", name: "Aceite 15W40", options: { Presentación: "Granel" }, sku: "AC", unit: "litro", price: 6.75, taxRate: 8, qty: 2, discount: 0, available: 40 }],
      cartDiscount: 1.5,
      pricesIncludeTax: true,
      payments: [{ key: "p", methodId: "pm", amount: 2400 }],
      methods: [{ id: "pm", name: "Pago móvil", currency: "VES", kind: "mobile_payment", applies_igtf: false }],
      money,
      change: null,
      customer: null,
      note: null,
    });
    expect(receipt.total).toBe(12);
    expect(receipt.items[0].description).toBe("Aceite 15W40 — Granel");
    expect(receipt.payments[0].amount_base).toBe(12);
    const html = receiptHtml(receipt, { businessName: "Demo" }, 58);
    expect(html).toContain("PEND-ABCDEF");
    expect(html).toContain("SIN CONEXIÓN");
  });
});
