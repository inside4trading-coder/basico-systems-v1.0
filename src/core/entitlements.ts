/**
 * Módulos, funciones y cuotas por tenant.
 *
 * Los defaults viven aquí; `tenant_entitlements` solo guarda excepciones
 * (un tenant normal tiene cero filas). En SQL, app.tenant_entitlement(t, key,
 * default) aplica la misma regla: la excepción vigente gana al default.
 *
 * Esto no son permisos de usuario: lo que un cajero puede hacer va en
 * tenant_members.role.
 */
export const ENTITLEMENT_DEFAULTS = {
  // Módulos de Start
  pos: true,
  inventario: true,
  administracion: true,
  reportes: true,
  // Add-ons
  fichaje: false,
  estudio: false,
  cashea: false,
  // Funciones
  can_export: true,
  // Cuotas
  max_locations: 1,
  max_registers: 2,
  max_users: 5,
  estudio_images_per_month: 0,
} as const;

export type EntitlementKey = keyof typeof ENTITLEMENT_DEFAULTS;
export type Entitlements = { [K in EntitlementKey]: (typeof ENTITLEMENT_DEFAULTS)[K] extends boolean ? boolean : number };

export interface EntitlementRow {
  key: string;
  value: unknown;
  expires_at: string | null;
}

function isKnownKey(key: string): key is EntitlementKey {
  return Object.prototype.hasOwnProperty.call(ENTITLEMENT_DEFAULTS, key);
}

/** Combina defaults con las excepciones vigentes del tenant. */
export function resolveEntitlements(rows: EntitlementRow[], now: Date = new Date()): Entitlements {
  const resolved: Record<string, boolean | number> = { ...ENTITLEMENT_DEFAULTS };

  for (const row of rows) {
    if (!isKnownKey(row.key)) continue;
    if (row.expires_at && new Date(row.expires_at) <= now) continue;

    const expected = typeof ENTITLEMENT_DEFAULTS[row.key];
    if (typeof row.value === expected) resolved[row.key] = row.value as boolean | number;
  }

  return resolved as Entitlements;
}

export type ModuleKey = "pos" | "inventario" | "administracion" | "reportes" | "fichaje" | "estudio" | "cashea";

/** Nombre de cada módulo para la pantalla (mismos textos que los errores de la base). */
export const MODULE_LABELS: Record<ModuleKey, string> = {
  pos: "Punto de venta",
  inventario: "Inventario",
  administracion: "Administración",
  reportes: "Reportes",
  fichaje: "Fichaje",
  estudio: "Studio",
  cashea: "Cashea",
};
