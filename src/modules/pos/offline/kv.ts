/**
 * Almacén clave-valor en IndexedDB para la cola de ventas y el catálogo local.
 * IndexedDB y no localStorage: el catálogo de una sede puede pasar de los
 * 5 MB y la cola tiene que sobrevivir a cierres del navegador.
 */

export interface KvStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
}

const DB_NAME = "bsys-pos";
const STORE = "kv";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = op(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result as T);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export const idbStore: KvStore = {
  get: (key) => run("readonly", (s) => s.get(key)),
  set: (key, value) => run("readwrite", (s) => s.put(value, key)),
  del: (key) => run("readwrite", (s) => s.delete(key)),
};

/** Para tests y navegadores sin IndexedDB: vive solo en memoria. */
export function memoryStore(): KvStore {
  const data = new Map<string, unknown>();
  return {
    get: async <T,>(key: string) => structuredClone(data.get(key)) as T | undefined,
    set: async (key, value) => void data.set(key, structuredClone(value)),
    del: async (key) => void data.delete(key),
  };
}

export const posStore: KvStore = typeof indexedDB === "undefined" ? memoryStore() : idbStore;
