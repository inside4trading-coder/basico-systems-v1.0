// Alta por enlace: crea la cuenta de quien abre un enlace de alta válido.
//
// El registro abierto está cerrado ([auth] enable_signup = false); esta
// función es la única puerta para crear una cuenta sin invitación de equipo.
//   1. signup_register_attempt valida el enlace (existe, sin usar, sin vencer,
//      correo fijo si lo trae) y cuenta el intento: máximo 3 cuentas por enlace.
//   2. Si el correo ya tiene cuenta, se le pide entrar: el canje lo hace con
//      su sesión.
//   3. Crea la cuenta con la contraseña elegida. El negocio NO se crea aquí:
//      la app inicia sesión y canjea con redeem_signup_invite, así el canje
//      siempre corre con la sesión real de la persona.

import { createClient } from "npm:@supabase/supabase-js@2.99.3";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^[0-9a-f]{24}$/;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Siempre 200 con { error }: así supabase.functions.invoke no esconde el motivo.
function json(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const REASONS: Record<string, string> = {
  no_existe: "Este enlace de alta no existe. Revisa que esté completo.",
  usado: "Este enlace de alta ya se usó. Si ya creaste tu negocio, entra con tu correo.",
  vencido: "Este enlace de alta venció. Pide uno nuevo.",
  otro_correo: "Este enlace es para otro correo.",
  sin_cupo: "Con este enlace ya se crearon varias cuentas. Pide uno nuevo.",
};

export function passwordProblem(password: string): string | null {
  if (password.length < 8 || password.length > 72) return "La contraseña debe tener entre 8 y 72 caracteres";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return "La contraseña debe combinar letras y números";
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" });

  let body: { code?: unknown; email?: unknown; password?: unknown; full_name?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" });
  }
  const code = typeof body.code === "string" ? body.code.trim().toLowerCase() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const fullName = typeof body.full_name === "string" ? body.full_name.trim().slice(0, 80) : "";

  if (!CODE_RE.test(code)) return json({ error: REASONS.no_existe });
  if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: "Correo inválido" });
  if (fullName.length < 2) return json({ error: "Escribe tu nombre" });
  const problem = passwordProblem(password);
  if (problem) return json({ error: problem });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const { data: existingId, error: lookupError } = await admin.rpc("platform_user_id_by_email", { p_email: email });
  if (lookupError) return json({ error: "No se pudo crear la cuenta. Intenta de nuevo." });
  if (existingId) return json({ error: "Ya tienes una cuenta con este correo: entra para crear tu negocio.", existing: true });

  const { data: attempt, error: attemptError } = await admin.rpc("signup_register_attempt", { p_code: code, p_email: email });
  if (attemptError) return json({ error: "No se pudo crear la cuenta. Intenta de nuevo." });
  if (!attempt?.ok) return json({ error: REASONS[attempt?.reason as string] ?? REASONS.no_existe });

  const { error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    // El enlace de alta lo mandó la plataforma: hace las veces de confirmación.
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (createError) {
    if (createError.code === "email_exists") {
      return json({ error: "Ya tienes una cuenta con este correo: entra para crear tu negocio.", existing: true });
    }
    if (createError.code === "weak_password") return json({ error: "Esa contraseña es muy débil: usa letras y números." });
    return json({ error: "No se pudo crear la cuenta. Intenta de nuevo." });
  }
  return json({ ok: true });
});
