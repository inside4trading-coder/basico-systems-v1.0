/**
 * Piezas comunes para seguir trabajando sin conexión (apagones, datos móviles
 * que se caen). Lo que vende sin red vive en src/modules/pos/offline.
 */
import { useEffect, useState } from "react";

/** Error de red (sin conexión, DNS, corte a mitad), no un rechazo del servidor. */
export function isNetworkError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const message = error instanceof Error ? error.message : typeof error === "object" && error ? String((error as { message?: unknown }).message ?? "") : String(error ?? "");
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet_disconnected|timed? ?out/i.test(message);
}

const PREFIX = "bsys.cache.";

export function readCache<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

export function writeCache(key: string, value: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Almacenamiento lleno o bloqueado: sin copia local, solo en línea.
  }
}

/** Al salir se borran las copias (no la cola de ventas pendientes: es dinero cobrado). */
export function clearCaches() {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(PREFIX)) localStorage.removeItem(key);
  } catch {
    // Nada que borrar.
  }
}

/** Con copia guardada, cuánto se espera al servidor antes de usarla. */
const CACHE_FALLBACK_MS = 4000;

/**
 * Envuelve un queryFn: guarda la última respuesta buena y, si falla por red,
 * devuelve esa copia. Solo para datos pequeños que el POS necesita para
 * arrancar (membresías, ajustes, métodos de pago, cajas, sesión abierta).
 *
 * supabase-js reintenta los GET con espera (1 s, 2 s, 4 s) ante errores de
 * red: con el servidor caído una consulta tarda ~15 s en fallar. Si hay copia,
 * no se espera tanto: sin red se usa al instante y con red se le da unos
 * segundos al servidor; la consulta sigue y, si llega, actualiza la copia.
 */
export function withOfflineCache<T>(key: string, fn: () => Promise<T>): () => Promise<T> {
  return async () => {
    const cached = readCache<T>(key);
    const live = fn().then((data) => {
      writeCache(key, data);
      return data;
    });
    if (cached === undefined) return live;
    live.catch(() => undefined);
    if (typeof navigator !== "undefined" && navigator.onLine === false) return cached;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const fallback = new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(cached), CACHE_FALLBACK_MS);
    });
    try {
      return await Promise.race([live, fallback]);
    } catch (error) {
      if (isNetworkError(error)) return cached;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}
