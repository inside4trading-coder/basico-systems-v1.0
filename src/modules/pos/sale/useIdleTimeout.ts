import { useEffect } from "react";

export const CONSULT_IDLE_MS = 90_000;

/** Llama a onIdle tras `ms` sin teclas, clics, toques ni desplazamiento. */
export function useIdleTimeout(onIdle: () => void, ms: number) {
  useEffect(() => {
    let timer = window.setTimeout(onIdle, ms);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(onIdle, ms);
    };
    const events = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true, capture: true }));
    return () => {
      window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset, { capture: true }));
    };
  }, [onIdle, ms]);
}
