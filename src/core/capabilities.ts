/**
 * Permisos por rol (capacidades). Los defaults son los mismos que
 * app.capability_defaults() en la base (un test compara ambos); cada negocio
 * guarda solo sus excepciones en role_capabilities. El owner siempre puede todo.
 *
 * La base hace cumplir cada capacidad; aquí solo se decide qué mostrar.
 */
import type { TenantRole } from "./tenant-selection";

export type EditableRole = Exclude<TenantRole, "owner">;
export const EDITABLE_ROLES: EditableRole[] = ["admin", "manager", "cajero"];

export type CapabilityArea = "ventas" | "inventario" | "administracion" | "configuracion";

export const AREA_LABELS: Record<CapabilityArea, string> = {
  ventas: "Ventas y caja",
  inventario: "Inventario",
  administracion: "Administración y reportes",
  configuracion: "Configuración y equipo",
};

interface CapabilityDef {
  label: string;
  area: CapabilityArea;
  /** Default por rol: admin, manager, cajero. */
  defaults: Record<EditableRole, boolean>;
}

const ALL = { admin: true, manager: true, cajero: true };
const AM = { admin: true, manager: true, cajero: false };
const A = { admin: true, manager: false, cajero: false };

export const CAPABILITIES = {
  "pos.vender": { label: "Vender en el punto de venta", area: "ventas", defaults: ALL },
  "ventas.corregir": { label: "Anular, devolver y corregir ventas", area: "ventas", defaults: AM },
  "caja.supervisar": { label: "Sacar efectivo o cerrar la caja de otra persona", area: "ventas", defaults: AM },
  "caja.cupones": { label: "Crear y editar cupones", area: "ventas", defaults: AM },
  "caja.cajeros": { label: "Gestionar cajeros (PIN de caja)", area: "ventas", defaults: A },
  "catalogo.editar": { label: "Editar catálogo, precios e importar", area: "inventario", defaults: AM },
  "catalogo.campos": { label: "Campos del catálogo", area: "inventario", defaults: A },
  "inventario.mover": { label: "Entradas, ajustes y traslados", area: "inventario", defaults: AM },
  "inventario.minimos": { label: "Mínimos y reposición", area: "inventario", defaults: AM },
  "inventario.conteos": { label: "Conteos de inventario", area: "inventario", defaults: AM },
  "inventario.firmar": { label: "Firmar ajustes", area: "inventario", defaults: A },
  "inventario.todas_sedes": { label: "Trabajar en todas las sedes", area: "inventario", defaults: A },
  "inventario.etiquetas": { label: "Etiquetas por unidad: generar, imprimir y desactivar", area: "inventario", defaults: AM },
  "reportes.ver": { label: "Ver reportes y clientes", area: "administracion", defaults: AM },
  "finanzas.operar": { label: "Operar Administración: movimientos, cobros, conciliación y Cashea", area: "administracion", defaults: AM },
  "finanzas.anular": { label: "Anular movimientos y cobros de Administración", area: "administracion", defaults: A },
  "finanzas.cuentas": { label: "Cuentas y guías de importación", area: "administracion", defaults: A },
  "config.negocio": { label: "Datos del negocio, tasa, impuestos, métodos de pago y canales", area: "configuracion", defaults: A },
  "config.sedes": { label: "Sedes y cajas", area: "configuracion", defaults: A },
  "equipo.gestionar": { label: "Invitar y gestionar el equipo", area: "configuracion", defaults: A },
  "fichaje.gestionar": { label: "Fichaje: revisar y gestionar", area: "configuracion", defaults: AM },
  "fichaje.enlace": { label: "Fichaje: cambiar el enlace", area: "configuracion", defaults: A },
  "estudio.usar": { label: "Usar el Estudio de IA", area: "configuracion", defaults: AM },
  "estudio.configurar": { label: "Configurar el Estudio de IA", area: "configuracion", defaults: A },
} as const satisfies Record<string, CapabilityDef>;

export type Capability = keyof typeof CAPABILITIES;
export const CAPABILITY_KEYS = Object.keys(CAPABILITIES) as Capability[];

export interface CapabilityOverride {
  role: string;
  capability: string;
  allowed: boolean;
}

function isCapability(key: string): key is Capability {
  return Object.prototype.hasOwnProperty.call(CAPABILITIES, key);
}

/** ¿Puede este rol, con las excepciones del negocio? */
export function roleAllows(role: TenantRole | undefined, capability: Capability, overrides: CapabilityOverride[]): boolean {
  if (!role) return false;
  if (role === "owner") return true;
  const override = overrides.find((o) => o.role === role && o.capability === capability);
  return override ? override.allowed : CAPABILITIES[capability].defaults[role];
}

/** Todas las capacidades de un rol. */
export function resolveCapabilities(role: TenantRole | undefined, overrides: CapabilityOverride[]): Set<Capability> {
  return new Set(CAPABILITY_KEYS.filter((key) => roleAllows(role, key, overrides.filter((o) => isCapability(o.capability)))));
}
