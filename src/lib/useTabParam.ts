import { useState } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Pestaña inicial desde `?tab=` (los accesos de Inicio llevan directo a una
 * pestaña); si no viene o no está permitida, la de siempre.
 */
export function useTabParam<T extends string>(allowed: readonly T[], fallback: T) {
  const [params] = useSearchParams();
  return useState<T>(() => {
    const requested = params.get("tab");
    return allowed.find((t) => t === requested) ?? fallback;
  });
}
