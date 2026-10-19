export type TenantRole = "owner" | "admin" | "manager" | "cajero";
export type TenantStatus = "active" | "suspended";

export interface Membership {
  role: TenantRole;
  tenant: { id: string; name: string; slug: string; status: TenantStatus; base_currency: string };
}

/**
 * Tenant con el que arranca la sesión: el último usado si el usuario sigue
 * siendo miembro; si no, el único que tiene. Con varios y sin uno recordado,
 * null: el usuario elige.
 */
export function pickInitialTenant(memberships: Membership[], storedTenantId: string | null): string | null {
  if (storedTenantId && memberships.some((m) => m.tenant.id === storedTenantId)) return storedTenantId;
  if (memberships.length === 1) return memberships[0].tenant.id;
  return null;
}

export function canManageTeam(role: TenantRole | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** Crear y editar catálogo, registrar entradas, ajustes y traslados. */
export function canEditCatalog(role: TenantRole | undefined): boolean {
  return role === "owner" || role === "admin" || role === "manager";
}

/** Reportes y cierres: ven costos y márgenes. */
export function canSeeReports(role: TenantRole | undefined): boolean {
  return role === "owner" || role === "admin" || role === "manager";
}

/** Firmar ajustes y administrar sedes. */
export function canSupervise(role: TenantRole | undefined): boolean {
  return role === "owner" || role === "admin";
}
