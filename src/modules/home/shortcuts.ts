/**
 * Accesos de Inicio. El catálogo sale del menú (AppShell) más las subpáginas
 * a las que se llega en dos clics: pestañas de Control, Reportes y
 * Administración, importar y campos del catálogo. Cada usuario elige y ordena
 * los suyos (tenant_members.home_shortcuts); sin elección, los de siempre
 * según su rol y los módulos del plan.
 */
import type { ModuleKey } from "@/core/entitlements";
import type { Capability } from "@/core/capabilities";

export type ShortcutIcon =
  | "cart"
  | "package"
  | "clipboard"
  | "package-plus"
  | "arrows"
  | "list-checks"
  | "refresh"
  | "upload"
  | "sliders"
  | "users"
  | "chart"
  | "receipt"
  | "landmark"
  | "calendar"
  | "hand-coins"
  | "scale"
  | "map-pin"
  | "settings"
  | "user-cog"
  | "clock"
  | "sparkles"
  | "layers";

export interface Shortcut {
  key: string;
  label: string;
  /** Módulo o sección donde vive, para la tarjeta. */
  caption: string;
  to: string;
  icon: ShortcutIcon;
  /** Capacidad que hace falta; sin ella, lo ve todo el equipo. */
  capability?: Capability;
  module?: ModuleKey;
}

export const SHORTCUTS: Shortcut[] = [
  { key: "pos", label: "Abrir POS", caption: "Punto de venta", to: "/pos", icon: "cart", capability: "pos.vender", module: "pos" },
  { key: "inventario", label: "Inventario", caption: "Catálogo y existencias", to: "/inventario", icon: "package", module: "inventario" },
  { key: "control", label: "Control", caption: "Inventario", to: "/control", icon: "clipboard", module: "inventario" },
  { key: "entrada", label: "Entrada rápida", caption: "Control", to: "/control?tab=entrada", icon: "package-plus", capability: "inventario.mover", module: "inventario" },
  { key: "traslados", label: "Traslados", caption: "Control", to: "/control?tab=traslados", icon: "arrows", capability: "inventario.mover", module: "inventario" },
  { key: "conteos", label: "Conteos", caption: "Control", to: "/control?tab=conteos", icon: "list-checks", module: "inventario" },
  { key: "reposicion", label: "Reposición", caption: "Control", to: "/control?tab=reposicion", icon: "refresh", capability: "inventario.minimos", module: "inventario" },
  { key: "importar", label: "Importar / Exportar", caption: "Inventario", to: "/inventario/importar", icon: "upload", capability: "catalogo.editar", module: "inventario" },
  { key: "campos", label: "Campos del catálogo", caption: "Inventario", to: "/catalogo/campos", icon: "sliders", capability: "catalogo.editar" },
  { key: "clientes", label: "Clientes", caption: "Punto de venta", to: "/clientes", icon: "users", capability: "reportes.ver", module: "pos" },
  { key: "reportes", label: "Reportes", caption: "Ventas e inventario", to: "/reportes", icon: "chart", capability: "reportes.ver", module: "reportes" },
  { key: "cierres", label: "Cierres de caja", caption: "Reportes", to: "/reportes?tab=closures", icon: "receipt", capability: "reportes.ver", module: "reportes" },
  { key: "administracion", label: "Administración", caption: "Tesorería", to: "/administracion", icon: "landmark", capability: "finanzas.operar", module: "administracion" },
  { key: "obligaciones", label: "Obligaciones", caption: "Administración", to: "/administracion?tab=obligations", icon: "calendar", capability: "finanzas.operar", module: "administracion" },
  { key: "estudio", label: "Estudio IA", caption: "Fotos de producto", to: "/estudio", icon: "sparkles", capability: "estudio.usar", module: "estudio" },
  { key: "cashea", label: "Cashea", caption: "Ventas en cuotas", to: "/cashea", icon: "layers", capability: "finanzas.operar", module: "cashea" },
  { key: "fichaje", label: "Fichaje", caption: "Personal", to: "/fichaje", icon: "clock", capability: "fichaje.gestionar", module: "fichaje" },
  { key: "por-cobrar", label: "Por cobrar", caption: "Administración", to: "/administracion?tab=receivables", icon: "hand-coins", capability: "finanzas.operar", module: "administracion" },
  { key: "conciliacion", label: "Conciliación", caption: "Administración", to: "/administracion?tab=reconciliation", icon: "scale", capability: "finanzas.operar", module: "administracion" },
  { key: "sedes", label: "Sedes", caption: "Negocio", to: "/sedes", icon: "map-pin", capability: "config.sedes" },
  { key: "configuracion", label: "Configuración", caption: "Negocio", to: "/configuracion", icon: "settings", capability: "config.negocio" },
  { key: "equipo", label: "Equipo", caption: "Negocio", to: "/equipo", icon: "user-cog", capability: "equipo.gestionar" },
];

/** Lo mismo que valida la base en app.set_home_shortcuts. */
export const MAX_SHORTCUTS = 12;

/** Los de siempre: en orden de prioridad, se toman los primeros que el usuario puede usar. */
const DEFAULT_KEYS = ["pos", "inventario", "control", "conteos", "reposicion", "reportes", "administracion", "clientes"];
const DEFAULT_COUNT = 6;

/** Accesos que los permisos del usuario y el plan permiten. */
export function allowedShortcuts(can: (capability: Capability) => boolean, modules: Partial<Record<ModuleKey, boolean>>): Shortcut[] {
  return SHORTCUTS.filter((s) => (!s.capability || can(s.capability)) && (!s.module || Boolean(modules[s.module])));
}

/**
 * Accesos a mostrar: los guardados, en su orden, sin los que ya no se pueden
 * usar (cambió el rol o el plan) ni claves que la app ya no conoce. Sin
 * elección guardada, los de siempre.
 */
export function selectShortcuts(saved: string[] | null | undefined, allowed: Shortcut[]): Shortcut[] {
  const byKey = new Map(allowed.map((s) => [s.key, s]));
  if (saved == null) {
    return DEFAULT_KEYS.flatMap((k) => byKey.get(k) ?? []).slice(0, DEFAULT_COUNT);
  }
  return [...new Set(saved)].flatMap((k) => byKey.get(k) ?? []).slice(0, MAX_SHORTCUTS);
}

/** Mueve un acceso una posición dentro de la lista. */
export function moveKey(keys: string[], key: string, delta: -1 | 1): string[] {
  const i = keys.indexOf(key);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= keys.length) return keys;
  const next = [...keys];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Recientes: las últimas rutas visitadas en este dispositivo. */
export const RECENT_LIMIT = 4;

export function pushRecent(recent: string[], path: string, limit = RECENT_LIMIT): string[] {
  return [path, ...recent.filter((p) => p !== path)].slice(0, limit);
}

/** Acceso del catálogo para una ruta visitada (coincide ruta y pestaña). */
export function shortcutForPath(path: string): Shortcut | undefined {
  return SHORTCUTS.find((s) => s.to === path) ?? SHORTCUTS.find((s) => s.to === path.split("?")[0]);
}
