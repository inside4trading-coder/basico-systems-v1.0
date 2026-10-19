/**
 * Lector de código de barras como teclado. Portado de useScannerGun.ts
 * (basicosystems@f551478b).
 *
 * La pistola escribe muy rápido y termina con Enter: eso es lo que se detecta.
 * El tecleo humano en cualquier campo no se secuestra.
 */
import { useEffect, useRef } from "react";

const MAX_GAP_MS = 45;
const MIN_LENGTH = 4;

export function useScanner(onScan: (code: string) => void, enabled = true) {
  const buffer = useRef("");
  const lastKeyAt = useRef(0);
  const fastKeys = useRef(0);
  const handler = useRef(onScan);
  handler.current = onScan;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const now = performance.now();
      const gap = now - lastKeyAt.current;
      lastKeyAt.current = now;

      if (e.key === "Enter") {
        const code = buffer.current.trim();
        const wasBurst = fastKeys.current >= MIN_LENGTH - 1;
        buffer.current = "";
        fastKeys.current = 0;
        if (code.length >= MIN_LENGTH && wasBurst) {
          // El campo enfocado no recibe también este Enter (evita duplicar).
          e.preventDefault();
          e.stopPropagation();
          handler.current(normalizeScannedCode(code));
        }
        return;
      }
      if (e.key.length !== 1) return;
      if (gap > MAX_GAP_MS) {
        buffer.current = e.key;
        fastKeys.current = 0;
        return;
      }
      buffer.current += e.key;
      fastKeys.current += 1;
      if (buffer.current.length > 64) buffer.current = "";
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enabled]);
}

/** Lector con distribución de teclado distinta: el guion llega como ' ´ o ?. */
export function normalizeScannedCode(raw: string): string {
  return raw.trim().replace(/['´?]/g, "-");
}
