/**
 * Guías del sistema de [B]eto vistas desde la app: la misma fuente que usa la
 * edge function (supabase/functions/_shared/beto-guides.ts).
 */
import { GUIDES } from "../../../supabase/functions/_shared/beto-guides";
import type { BetoBlock, BetoLink } from "./api";

/** Rutas a las que puede llevar un botón «Ir a…». */
export const GUIDE_ROUTES = new Set(GUIDES.map((g) => g.ruta));

/** Solo rutas de las guías: aunque el bloque venga guardado, nunca se navega a otra parte. */
export function safeLinks(blocks: BetoBlock[] | null): BetoLink[] {
  return (blocks ?? []).filter((b): b is BetoLink => b.type === "link" && GUIDE_ROUTES.has(b.to)).slice(0, 2);
}
