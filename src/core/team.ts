import type { TenantRole } from "./tenant-selection";

/**
 * Qué puede hacer quien gestiona el equipo con un miembro (mismas reglas que
 * las policies de tenant_members): owner o admin gestionan; solo un owner toca
 * a otro owner o nombra owners. Nadie se edita a sí mismo desde aquí, para no
 * quedarse fuera por error.
 */
export function canEditMember(myRole: TenantRole | undefined, myUserId: string | undefined, member: { user_id: string; role: TenantRole }): boolean {
  if (!myRole || !myUserId || member.user_id === myUserId) return false;
  if (myRole === "owner") return true;
  return myRole === "admin" && member.role !== "owner";
}

/** Roles que se pueden asignar: el de owner solo lo da otro owner. */
export function assignableRoles(myRole: TenantRole | undefined): TenantRole[] {
  const base: TenantRole[] = ["cajero", "manager", "admin"];
  return myRole === "owner" ? [...base, "owner"] : base;
}

/** Mensaje claro para los errores de la base al cambiar o quitar a alguien. */
export function teamErrorMessage(message: string): string {
  if (/sin owner/i.test(message)) return "El negocio necesita al menos un dueño.";
  if (/row-level security|permission|permiso/i.test(message)) return "No tienes permiso para cambiar a esta persona.";
  return message || "No se pudo guardar el cambio.";
}
