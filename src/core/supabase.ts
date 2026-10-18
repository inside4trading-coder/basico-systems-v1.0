import { createClient } from "@supabase/supabase-js";
import { getActiveTenantId } from "./tenant";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error("Faltan VITE_SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY (ver .env.example)");
}

// Cada request lleva el tenant activo en `x-tenant-id`. En la base,
// current_tenant_id() lo lee, valida la membresía y lo usa como DEFAULT de
// tenant_id y en las policies; así las queries no repiten el filtro.
// El header nunca da acceso por sí solo: sin membresía, la función devuelve NULL.
const tenantFetch: typeof fetch = (input, init = {}) => {
  const tenantId = getActiveTenantId();
  if (!tenantId) return fetch(input, init);
  const headers = new Headers(init.headers);
  headers.set("x-tenant-id", tenantId);
  return fetch(input, { ...init, headers });
};

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, storage: localStorage },
  global: { fetch: tenantFetch },
});
