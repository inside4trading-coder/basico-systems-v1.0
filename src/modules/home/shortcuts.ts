/**
 * Accesos de Inicio. El catálogo sale del menú (AppShell) más las subpáginas
 * a las que se llega en dos clics: pestañas de Control, Reportes y
 * Administración, importar y campos del catálogo. Cada usuario elige y ordena
 * los suyos (tenant_members.home_shortcuts); sin elección, los de siempre
 * según su rol y los módulos del plan.
 */
import type { ModuleKey } from "@/core/entitlements";
import { canEditCatalog, canManageTeam, canSeeReports, canSupervise, type TenantRole } from "@/core/tenant-selection";

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
  visible: (role: TenantRole | undefined) => boolean;
  module?: ModuleKey;
}

const everyone = () => true;

export const SHORTCUTS: Shortcut[] = [
  { key: "pos", label: "Abrir POS", caption: "Punto de venta", to: "/pos", icon: "cart", visible: everyone, module: "pos" },
  { key: "inventario", label: "Inventario", caption: "Catálogo y existencias", to: "/inventario", icon: "package", visible: everyone, module: "inventario" },
  { key: "control", label: "Control", caption: "Inventario", to: "/control", icon: "clipboard", visible: everyone, module: "inventario" },
  { key: "entrada", label: "Entrada rápida", caption: "Control", to: "/control?tab=entrada", icon: "package-plus", visible: canEditCatalog, module: "inventario" },
  { key: "traslados", label: "Traslados", caption: "Control", to: "/control?tab=traslados", icon: "arrows", visible: canEditCatalog, module: "inventario" },
  { key: "conteos", label: "Conteos", caption: "Control", to: "/control?tab=conteos", icon: "list-checks", visible: everyone, module: "inventario" },
  { key: "reposicion", label: "Reposición", caption: "Control", to: "/control?tab=reposicion", icon: "refresh", visible: canEditCatalog, module: "inventario" },
  { key: "importar", label: "Importar / Exportar", caption: "Inventario", to: "/inventario/importar", icon: "upload", visible: canEditCatalog, module: "inventario" },
  { key: "campos", label: "Campos del catálogo", caption: "Inventario", to: "/catalogo/campos", icon: "sliders", visible: canEditCatalog },
  { key: "clientes", label: "Clientes", caption: "Punto de venta", to: "/clientes", icon: "users", visible: canSeeReports, module: "pos" },
  { key: "reportes", label: "Reportes", caption: "Ventas e inventario", to: "/reportes", icon: "chart", visible: canSeeReports, module: "reportes" },
  { key: "cierres", label: "Cierres de caja", caption: "Reportes", to: "/reportes?tab=closures", icon: "receipt", visible: canSeeReports, module: "reportes" },
  { key: "administracion", label: "Administración", caption: "Tesorería", to: "/administracion", icon: "landmark", visible: canSeeReports, module: "administracion" },
  { key: "obligaciones", label: "Obligaciones", caption: "Administración", to: "/administracion?tab=obligations", icon: "calendar", visible: canSeeReports, module: "administracion" },
  { key: "estudio", label: "Estudio IA", caption: "Fotos de producto", to: "/estudio", icon: "sparkles", visible: canEditCatalog, module: "estudio" },
  { key: "cashea", label: "Cashea", caption: "Ventas en cuotas", to: "/cashea", icon: "layers", visible: canSeeReports, module: "cashea" },
  { key: "fichaje", label: "Fichaje", caption: "Personal", to: "/fichaje", icon: "clock", visible: canSeeReports, module: "fichaje" },
  { key: "por-cobrar", label: "Por cobrar", caption: "Administración", to: "/administracion?tab=receivables", icon: "hand-coins", visible: canSeeReports, module: "administracion" },
  { key: "conciliacion", label: "Conciliación", caption: "Administración", to: "/administracion?tab=reconciliation", icon: "scale", visible: canSeeReports, module: "administracion" },
  { key: "sedes", label: "Sedes", caption: "Negocio", to: "/sedes", icon: "map-pin", visible: canSupervise },
  { key: "configuracion", label: "Configuración", caption: "Negocio", to: "/configuracion", icon: "settings", visible: canSupervise },
  { key: "equipo", label: "Equipo", caption: "Negocio", to: "/equipo", icon: "user-cog", visible: canManageTeam },
];

/** Lo mismo que valida la base en app.set_home_shortcuts. */
export const MAX_SHORTCUTS = 12;

/** Los de siempre: en orden de prioridad, se toman los primeros que el usuario puede usar. */
const DEFAULT_KEYS = ["pos", "inventario", "control", "conteos", "reposicion", "reportes", "administracion", "clientes"];
const DEFAULT_COUNT = 6;

/** Accesos que el rol y el plan permiten. */
export function allowedShortcuts(role: TenantRole | undefined, modules: Partial<Record<ModuleKey, boolean>>): Shortcut[] {
  return SHORTCUTS.filter((s) => s.visible(role) && (!s.module || Boolean(modules[s.module])));
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
