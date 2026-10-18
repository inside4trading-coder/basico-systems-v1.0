const STORAGE_KEY = "bsys.activeTenantId";

let activeTenantId: string | null = readStored();

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getActiveTenantId(): string | null {
  return activeTenantId;
}

export function setActiveTenantId(tenantId: string | null): void {
  activeTenantId = tenantId;
  try {
    if (tenantId) localStorage.setItem(STORAGE_KEY, tenantId);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Sin almacenamiento (modo privado): el tenant vive solo en memoria.
  }
}
