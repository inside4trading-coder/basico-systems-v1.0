/**
 * Menú lateral: módulos (columna de iconos) y sus submódulos (panel).
 * Cada submódulo lleva a una página, a una pestaña (`?tab=`) o a una sección
 * (`#id`). Se muestra solo lo que permiten los permisos del rol y el plan.
 */
import type { LucideIcon } from "lucide-react";
import { BarChart3, Home, Landmark, Layers, Package, Settings, ShoppingCart, Sparkles, Users } from "lucide-react";
import type { Capability } from "@/core/capabilities";
import type { ModuleKey } from "@/core/entitlements";

export interface NavItem {
  label: string;
  /** Ruta con `?tab=` o `#sección` opcionales. */
  to: string;
  capability?: Capability;
  module?: ModuleKey;
}

export interface NavGroup {
  /** Sin título, los ítems van sueltos. */
  label?: string;
  items: NavItem[];
}

export interface NavModule {
  key: string;
  label: string;
  /** Subtítulo en la cabecera del panel. */
  caption: string;
  icon: LucideIcon;
  groups: NavGroup[];
}

const tab = (path: string, value: string) => `${path}?tab=${value}`;

export const NAV_MODULES: NavModule[] = [
  {
    key: "inicio",
    label: "Inicio",
    caption: "Tu negocio hoy",
    icon: Home,
    groups: [
      {
        items: [
          { label: "Inicio", to: "/" },
          { label: "Primeros pasos", to: "/bienvenida", capability: "config.negocio" },
        ],
      },
    ],
  },
  {
    key: "comercial",
    label: "Comercial",
    caption: "Ventas y clientes",
    icon: ShoppingCart,
    groups: [
      {
        items: [
          { label: "Abrir POS", to: "/pos", capability: "pos.vender", module: "pos" },
          { label: "Clientes", to: "/clientes", capability: "reportes.ver", module: "pos" },
        ],
      },
    ],
  },
  {
    key: "inventario",
    label: "Inventario",
    caption: "Catálogo y existencias",
    icon: Package,
    groups: [
      {
        label: "Catálogo",
        items: [
          { label: "Inventario maestro", to: "/inventario", module: "inventario" },
          { label: "Importar y exportar", to: "/inventario/importar", capability: "catalogo.editar", module: "inventario" },
          { label: "Campos del catálogo", to: "/catalogo/campos", capability: "catalogo.editar", module: "inventario" },
        ],
      },
      {
        label: "Operación",
        items: [
          { label: "Resumen", to: tab("/control", "resumen"), module: "inventario" },
          { label: "Entrada rápida", to: tab("/control", "entrada"), capability: "inventario.mover", module: "inventario" },
          { label: "Recepción", to: tab("/control", "recepcion"), capability: "inventario.mover", module: "inventario" },
          { label: "Ajustes", to: tab("/control", "ajustes"), capability: "inventario.mover", module: "inventario" },
          { label: "Traslados", to: tab("/control", "traslados"), capability: "inventario.mover", module: "inventario" },
          { label: "Reposición", to: tab("/control", "reposicion"), capability: "inventario.mover", module: "inventario" },
          { label: "Conteos", to: tab("/control", "conteos"), module: "inventario" },
          { label: "Firmas", to: tab("/control", "firmas"), module: "inventario" },
          { label: "Historial", to: tab("/control", "historial"), module: "inventario" },
          { label: "Mermas", to: tab("/control", "reportes"), module: "inventario" },
        ],
      },
    ],
  },
  {
    key: "administracion",
    label: "Administración",
    caption: "Tesorería y cobros",
    icon: Landmark,
    groups: [
      {
        items: [
          { label: "Resumen", to: tab("/administracion", "summary"), capability: "finanzas.operar", module: "administracion" },
          { label: "Movimientos", to: tab("/administracion", "movements"), capability: "finanzas.operar", module: "administracion" },
          { label: "Obligaciones", to: tab("/administracion", "obligations"), capability: "finanzas.operar", module: "administracion" },
          { label: "Por cobrar", to: tab("/administracion", "receivables"), capability: "finanzas.operar", module: "administracion" },
          { label: "Conciliación", to: tab("/administracion", "reconciliation"), capability: "finanzas.operar", module: "administracion" },
          { label: "Cuentas", to: tab("/administracion", "accounts"), capability: "finanzas.operar", module: "administracion" },
          { label: "Categorías", to: tab("/administracion", "catalog"), capability: "finanzas.operar", module: "administracion" },
        ],
      },
      {
        label: "Cashea",
        items: [
          { label: "Operaciones", to: tab("/cashea", "operations"), capability: "finanzas.operar", module: "cashea" },
          { label: "Importar archivos", to: tab("/cashea", "files"), capability: "finanzas.operar", module: "cashea" },
          { label: "Historial", to: tab("/cashea", "history"), capability: "finanzas.operar", module: "cashea" },
        ],
      },
    ],
  },
  {
    key: "reportes",
    label: "Reportes",
    caption: "Ventas, inventario e impuestos",
    icon: BarChart3,
    groups: [
      {
        items: [
          { label: "Ventas", to: tab("/reportes", "sales"), capability: "reportes.ver", module: "reportes" },
          { label: "Inventario", to: tab("/reportes", "stock"), capability: "reportes.ver", module: "reportes" },
          { label: "Cierres de caja", to: tab("/reportes", "closures"), capability: "reportes.ver", module: "reportes" },
          { label: "IVA", to: tab("/reportes", "tax"), capability: "reportes.ver", module: "reportes" },
          { label: "Resultado", to: tab("/reportes", "income"), capability: "reportes.ver", module: "administracion" },
        ],
      },
    ],
  },
  {
    key: "equipo",
    label: "Equipo",
    caption: "Personas, permisos y fichaje",
    icon: Users,
    groups: [
      {
        items: [
          { label: "Personas", to: tab("/equipo", "personas"), capability: "equipo.gestionar" },
          { label: "Permisos por rol", to: tab("/equipo", "permisos"), capability: "equipo.gestionar" },
        ],
      },
      {
        label: "Fichaje",
        items: [
          { label: "En turno", to: tab("/fichaje", "turno"), capability: "fichaje.gestionar", module: "fichaje" },
          { label: "Historial", to: tab("/fichaje", "historial"), capability: "fichaje.gestionar", module: "fichaje" },
          { label: "Incidencias", to: tab("/fichaje", "incidencias"), capability: "fichaje.gestionar", module: "fichaje" },
          { label: "Métricas", to: tab("/fichaje", "metricas"), capability: "fichaje.gestionar", module: "fichaje" },
          { label: "Personal y horarios", to: tab("/fichaje", "horarios"), capability: "fichaje.gestionar", module: "fichaje" },
          { label: "Sedes del fichaje", to: tab("/fichaje", "sedes"), capability: "fichaje.gestionar", module: "fichaje" },
        ],
      },
    ],
  },
  {
    key: "estudio",
    label: "Estudio IA",
    caption: "Fotos de producto",
    icon: Sparkles,
    groups: [{ items: [{ label: "Estudio de IA", to: "/estudio", capability: "estudio.usar", module: "estudio" }] }],
  },
  {
    key: "configuracion",
    label: "Configuración",
    caption: "Negocio, sedes y cobros",
    icon: Settings,
    groups: [
      {
        label: "Negocio",
        items: [
          { label: "Datos del negocio", to: "/configuracion#negocio", capability: "config.negocio" },
          { label: "Tasa de cambio", to: "/configuracion#tasa", capability: "config.negocio" },
          { label: "Impuestos", to: "/configuracion#impuestos", capability: "config.negocio" },
          { label: "Plan", to: "/configuracion#plan", capability: "config.negocio" },
          { label: "Exportar datos", to: "/configuracion#exportar", capability: "config.negocio" },
        ],
      },
      {
        label: "Ventas",
        items: [
          { label: "Sedes y cajas", to: "/sedes", capability: "config.sedes" },
          { label: "Métodos de pago", to: "/configuracion#pagos", capability: "config.negocio" },
          { label: "Cajeros", to: "/configuracion#cajeros", capability: "caja.cajeros" },
          { label: "Canales de venta", to: "/configuracion#canales", capability: "config.negocio" },
          { label: "Cupones", to: "/configuracion#cupones", capability: "caja.cupones" },
          { label: "Recordatorio de cierre", to: "/configuracion#cierre", capability: "config.negocio" },
        ],
      },
    ],
  },
];

export type Can = (capability: Capability) => boolean;
export type Modules = Partial<Record<ModuleKey, boolean>>;

/** Módulos con sus submódulos visibles para este usuario y este plan; sin submódulos visibles, el módulo no sale. */
export function visibleModules(can: Can, modules: Modules, all: NavModule[] = NAV_MODULES): NavModule[] {
  return all
    .map((m) => ({
      ...m,
      groups: m.groups
        .map((g) => ({ ...g, items: g.items.filter((i) => (!i.capability || can(i.capability)) && (!i.module || Boolean(modules[i.module]))) }))
        .filter((g) => g.items.length > 0),
    }))
    .filter((m) => m.groups.length > 0);
}

interface Place {
  pathname: string;
  search: string;
  hash: string;
}

function parse(to: string) {
  const url = new URL(to, "http://x");
  return { pathname: url.pathname, tab: url.searchParams.get("tab"), hash: url.hash };
}

/** ¿Este submódulo es la pantalla actual? Sin pestaña en la dirección, cuenta la primera del grupo. */
export function isItemActive(item: NavItem, place: Place, siblings: NavItem[] = []): boolean {
  const target = parse(item.to);
  if (target.pathname !== place.pathname) return false;
  const currentTab = new URLSearchParams(place.search).get("tab");
  if (target.tab) {
    if (currentTab) return currentTab === target.tab;
    // Sin ?tab= se ve la pestaña por defecto: la primera del mismo camino.
    const first = siblings.find((s) => parse(s.to).pathname === target.pathname);
    return first === item;
  }
  if (target.hash) return place.hash === target.hash;
  return true;
}

/** Módulo al que pertenece la página actual (el de su primer submódulo con ese camino). */
export function moduleForPath(pathname: string, list: NavModule[]): NavModule | null {
  return list.find((m) => m.groups.some((g) => g.items.some((i) => parse(i.to).pathname === pathname))) ?? null;
}
