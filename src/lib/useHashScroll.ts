import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Lleva a la sección `#id` de la dirección (enlaces del menú lateral a una
 * sección). Reintenta mientras la página termina de cargar sus datos, porque
 * al principio la sección puede no tener alto todavía.
 */
export function useHashScroll() {
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const id = decodeURIComponent(hash.slice(1));
    const go = () => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    go();
    const timers = [300, 900, 1800].map((ms) => window.setTimeout(go, ms));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [hash]);
}
