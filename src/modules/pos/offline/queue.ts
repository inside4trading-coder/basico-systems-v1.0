/**
 * Cola de ventas cobradas sin conexión.
 *
 * Cada venta guarda la misma clave de idempotencia que usaría en línea y la
 * hora del cobro. Al volver la red se manda en orden; si el servidor ya la
 * tenía (la red cayó después de guardarla) responde duplicate y se quita igual.
 * Un rechazo del servidor (stock que ya no alcanza, caja cerrada) no se
 * reintenta solo: queda "requiere atención" para que alguien decida.
 */
import { isNetworkError } from "@/core/offline";
import type { RegisterSaleInput, RegisterSaleResult, SaleReceipt } from "../api";
import type { KvStore } from "./kv";

export interface QueuedSale {
  key: string;
  sessionId: string;
  soldAt: string;
  input: RegisterSaleInput;
  /** Nota de entrega provisional, impresa al cobrar. */
  receipt: SaleReceipt;
  status: "pending" | "failed";
  attempts: number;
  error: string | null;
}

export interface SyncOutcome {
  synced: { sale: QueuedSale; result: RegisterSaleResult }[];
  failed: QueuedSale[];
  /** Se cortó la red a mitad: lo que queda sigue pendiente. */
  interrupted: boolean;
}

const queueKey = (tenantId: string) => `queue:${tenantId}`;

// Una sola escritura a la vez: cobrar mientras se sincroniza no pisa la cola.
let lock: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = lock.then(fn, fn);
  lock = next.catch(() => undefined);
  return next;
}

export async function loadQueue(store: KvStore, tenantId: string): Promise<QueuedSale[]> {
  return (await store.get<QueuedSale[]>(queueKey(tenantId))) ?? [];
}

async function update(store: KvStore, tenantId: string, change: (queue: QueuedSale[]) => QueuedSale[]): Promise<QueuedSale[]> {
  return exclusive(async () => {
    const next = change(await loadQueue(store, tenantId));
    await store.set(queueKey(tenantId), next);
    return next;
  });
}

export function enqueueSale(store: KvStore, tenantId: string, sale: QueuedSale) {
  return update(store, tenantId, (q) => (q.some((x) => x.key === sale.key) ? q : [...q, sale]));
}

export function discardSale(store: KvStore, tenantId: string, key: string) {
  return update(store, tenantId, (q) => q.filter((x) => x.key !== key));
}

export function retrySale(store: KvStore, tenantId: string, key: string) {
  return update(store, tenantId, (q) => q.map((x) => (x.key === key ? { ...x, status: "pending" as const, error: null } : x)));
}

export function pendingForSession(queue: QueuedSale[], sessionId: string): QueuedSale[] {
  return queue.filter((x) => x.sessionId === sessionId);
}

/** Manda las pendientes en el orden en que se cobraron. */
export async function syncQueue(
  store: KvStore,
  tenantId: string,
  send: (input: RegisterSaleInput) => Promise<RegisterSaleResult>,
): Promise<SyncOutcome> {
  const outcome: SyncOutcome = { synced: [], failed: [], interrupted: false };
  const pending = (await loadQueue(store, tenantId)).filter((x) => x.status === "pending").sort((a, b) => a.soldAt.localeCompare(b.soldAt));

  for (const sale of pending) {
    try {
      const result = await send(sale.input);
      await discardSale(store, tenantId, sale.key);
      outcome.synced.push({ sale, result });
    } catch (error) {
      if (isNetworkError(error)) {
        await update(store, tenantId, (q) => q.map((x) => (x.key === sale.key ? { ...x, attempts: x.attempts + 1 } : x)));
        outcome.interrupted = true;
        break;
      }
      const message = error instanceof Error ? error.message : String(error);
      const failed = { ...sale, status: "failed" as const, attempts: sale.attempts + 1, error: message };
      await update(store, tenantId, (q) => q.map((x) => (x.key === sale.key ? failed : x)));
      outcome.failed.push(failed);
    }
  }
  return outcome;
}

export function provisionalNumber(key: string): string {
  return `PEND-${key.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}
