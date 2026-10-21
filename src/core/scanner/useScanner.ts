/**
 * Lector de código de barras como teclado, en toda la pantalla. Portado de
 * useScannerGun.ts (basicosystems@f551478b).
 *
 * Escucha antes que los campos: si la lectura termina con Enter, ese Enter no
 * llega al campo enfocado (evita buscar dos veces).
 */
import { useEffect, useRef } from "react";
import { createBurstDetector } from "./burst";

export { normalizeScannedCode } from "./burst";

export function useScanner(onScan: (code: string) => void, enabled = true) {
  const handler = useRef(onScan);
  handler.current = onScan;

  useEffect(() => {
    if (!enabled) return;
    const detector = createBurstDetector((code) => handler.current(code));
    const onKeyDown = (e: KeyboardEvent) => {
      if (detector.handleKey(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      detector.dispose();
    };
  }, [enabled]);
}
