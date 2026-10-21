/**
 * Detector de lectores de código de barras que se comportan como teclado.
 *
 * La pistola escribe muy rápido. Unas terminan con Enter y otras no, según
 * cómo vengan configuradas: la lectura se da por terminada con el Enter o con
 * una pausa corta después de la ráfaga. El tecleo humano no se toma como
 * lectura porque nunca va tan rápido.
 */

export const MAX_GAP_MS = 45;
export const MIN_LENGTH = 4;
export const IDLE_MS = 120;
const MAX_LENGTH = 64;

export interface BurstKey {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

export interface BurstDetector {
  /** Devuelve true si la tecla cerró una lectura y no debe llegar al campo. */
  handleKey(event: BurstKey): boolean;
  dispose(): void;
}

interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

const browserClock: Clock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id as number),
};

export function createBurstDetector(onScan: (code: string) => void, clock: Clock = browserClock): BurstDetector {
  let buffer = "";
  let fastKeys = 0;
  let lastKeyAt = Number.NEGATIVE_INFINITY;
  let idleTimer: unknown = null;

  const reset = () => {
    buffer = "";
    fastKeys = 0;
  };
  const stopTimer = () => {
    if (idleTimer !== null) clock.clearTimeout(idleTimer);
    idleTimer = null;
  };
  // Una ráfaga es lectura si casi todas sus teclas llegaron seguidas.
  const takeBurst = (): string | null => {
    const code = buffer.trim();
    const isBurst = code.length >= MIN_LENGTH && fastKeys >= MIN_LENGTH - 1;
    reset();
    return isBurst ? normalizeScannedCode(code) : null;
  };

  return {
    handleKey(event) {
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      const now = clock.now();
      const gap = now - lastKeyAt;
      lastKeyAt = now;

      if (event.key === "Enter") {
        stopTimer();
        const code = takeBurst();
        if (code) onScan(code);
        return code !== null;
      }
      if (event.key.length !== 1) return false;

      if (gap > MAX_GAP_MS) {
        buffer = event.key;
        fastKeys = 0;
      } else {
        buffer += event.key;
        fastKeys += 1;
        if (buffer.length > MAX_LENGTH) reset();
      }
      // Lector sin Enter al final: la pausa tras la ráfaga cierra la lectura.
      stopTimer();
      idleTimer = clock.setTimeout(() => {
        idleTimer = null;
        const code = takeBurst();
        if (code) onScan(code);
      }, IDLE_MS);
      return false;
    },
    dispose() {
      stopTimer();
      reset();
    },
  };
}

/** Lector con distribución de teclado distinta: el guion llega como ' ´ o ?. */
export function normalizeScannedCode(raw: string): string {
  return raw.trim().replace(/['´?]/g, "-");
}
