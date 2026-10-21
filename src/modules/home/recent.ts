/**
 * Actividad reciente: las últimas rutas visitadas, solo en este dispositivo y
 * por negocio. Es comodidad; si el navegador no deja guardar, no pasa nada.
 */
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { pushRecent, shortcutForPath } from "./shortcuts";

const storageKey = (tenantId: string) => `bs:recent:${tenantId}`;

export function readRecent(tenantId: string | undefined): string[] {
  if (!tenantId) return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(tenantId)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function writeRecent(tenantId: string, recent: string[]) {
  try {
    localStorage.setItem(storageKey(tenantId), JSON.stringify(recent));
  } catch {
    // Sin almacenamiento (modo privado, cuota llena): se ignora.
  }
}

/** Anota la ruta actual si corresponde a un acceso del catálogo. */
export function useTrackRecent(tenantId: string | undefined) {
  const { pathname, search } = useLocation();
  useEffect(() => {
    if (!tenantId) return;
    const path = pathname + search;
    if (!shortcutForPath(path)) return;
    writeRecent(tenantId, pushRecent(readRecent(tenantId), path));
  }, [tenantId, pathname, search]);
}
