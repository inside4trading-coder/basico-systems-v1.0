import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Pestaña de la página guardada en `?tab=`: los accesos de Inicio y el menú
 * lateral llevan directo a una pestaña, y cambiar de pestaña actualiza la
 * dirección. Si no viene o no está permitida, la de siempre.
 */
export function useTabParam<T extends string>(allowed: readonly T[], fallback: T): [T, (tab: T) => void] {
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab");
  const tab = allowed.find((t) => t === requested) ?? fallback;
  const setTab = useCallback(
    (next: T) =>
      setParams(
        (prev) => {
          const updated = new URLSearchParams(prev);
          updated.set("tab", next);
          return updated;
        },
        { replace: true },
      ),
    [setParams],
  );
  return [tab, setTab];
}
