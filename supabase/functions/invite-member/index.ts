// Invita a una persona al equipo de un tenant.
//
// Quién puede: quien tenga el permiso «Invitar y gestionar el equipo» (se
// comprueba con la sesión de quien llama, antes de mandar ningún correo). El
// alta en tenant_members también va con esa sesión, así que la RLS vuelve a
// validar el permiso.
//
// Si la persona no tiene cuenta, se crea por invitación (Supabase manda el
// correo). Si ya la tiene, solo se la agrega al equipo.

import { createClient } from "npm:@supabase/supabase-js@2.99.3";

const INVITABLE_ROLES = ["admin", "manager", "cajero"] as const;
type InvitableRole = (typeof INVITABLE_ROLES)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Método no permitido" });

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json(401, { error: "Sesión requerida" });

  let body: { tenant_id?: unknown; email?: unknown; role?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "JSON inválido" });
  }

  const tenantId = typeof body.tenant_id === "string" ? body.tenant_id : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = body.role as InvitableRole;

  if (!UUID_RE.test(tenantId)) return json(400, { error: "tenant_id inválido" });
  if (!EMAIL_RE.test(email) || email.length > 254) return json(400, { error: "Correo inválido" });
  if (!INVITABLE_ROLES.includes(role)) return json(400, { error: "Rol inválido" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await asCaller.auth.getUser();
  if (userError || !userData.user) return json(401, { error: "Sesión inválida" });

  // Permiso «Invitar y gestionar el equipo» de la matriz del negocio.
  const { data: allowed, error: permError } = await asCaller.rpc("has_capability", {
    p_tenant_id: tenantId,
    p_capability: "equipo.gestionar",
  });
  if (permError) return json(500, { error: "No se pudo comprobar el permiso" });
  if (allowed !== true) return json(403, { error: "Tu rol no tiene permiso para invitar" });

  const asPlatform = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: existingId, error: lookupError } = await asPlatform.rpc("platform_user_id_by_email", {
    p_email: email,
  });
  if (lookupError) return json(500, { error: "No se pudo buscar el usuario" });

  let userId = existingId as string | null;
  let invited = false;

  if (!userId) {
    const appUrl = Deno.env.get("APP_URL");
    const { data: inviteData, error: inviteError } = await asPlatform.auth.admin.inviteUserByEmail(
      email,
      // needs_password: al entrar por primera vez la app le pide crear su contraseña.
      { data: { needs_password: true }, ...(appUrl ? { redirectTo: appUrl } : {}) },
    );
    if (inviteError || !inviteData.user) return json(502, { error: "No se pudo enviar la invitación" });
    userId = inviteData.user.id;
    invited = true;
  }

  const { error: insertError } = await asCaller
    .from("tenant_members")
    .insert({ tenant_id: tenantId, user_id: userId, role });

  if (insertError) {
    if (insertError.code === "23505") return json(409, { error: "Esa persona ya está en el equipo" });
    return json(403, { error: "No se pudo agregar al equipo" });
  }

  return json(201, { user_id: userId, invited });
});
