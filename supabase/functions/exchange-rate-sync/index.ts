// Actualiza la tasa oficial USD/VES y EUR/VES en exchange_rates.
//
// Port de supabase/functions/sublime-bcv-rate (basicosystems@f551478b):
//   * Fuente principal: la página del BCV, que publica la "fecha valor" (el
//     día desde el que rige la tasa). Su servidor envía mal la cadena de
//     certificados, así que se le agrega el intermedio correcto
//     (_shared/bcv-ca.ts) solo para esa petición.
//   * Respaldo: DolarAPI, que replica la tasa oficial con la misma fecha valor.
//   * Sin tasa manual aquí: la tasa propia del negocio va en tenant_rates y
//     solo la escriben dueño y administrador (en Sublime cualquier usuario podía).
//
// La puede llamar cualquier usuario con sesión: solo lee fuentes públicas y
// no recibe valores del cliente. Si ya se actualizó hace menos de 30 minutos,
// no vuelve a consultar.

import { createClient } from "npm:@supabase/supabase-js@2.99.3";
import { caracasDate, parseBcvHtml, parseRate, type Rate } from "../_shared/bcv.ts";
import { BCV_INTERMEDIATE_CA } from "../_shared/bcv-ca.ts";

const BCV_URL = "https://www.bcv.org.ve/";
const DOLARAPI = { USD: "https://ve.dolarapi.com/v1/dolares", EUR: "https://ve.dolarapi.com/v1/euros" };
const MIN_INTERVAL_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 8000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function fetchWithTimeout(url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Cliente HTTP que confía además en el intermedio que el BCV no envía. */
let bcvClientError: string | null = null;
function bcvClient(): Deno.HttpClient | undefined {
  try {
    return Deno.createHttpClient({ caCerts: [BCV_INTERMEDIATE_CA] });
  } catch (err) {
    bcvClientError = (err as Error).message;
    return undefined;
  }
}

async function fromBcv(): Promise<Rate[]> {
  const client = bcvClient();
  const resp = await fetchWithTimeout(BCV_URL, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; BasicoSystems/1.0)" },
    ...(client ? { client } : {}),
  } as RequestInit);
  if (!resp.ok) throw new Error(`BCV HTTP ${resp.status}`);
  return parseBcvHtml(await resp.text());
}

async function fromDolarApi(): Promise<Rate[]> {
  const out: Rate[] = [];
  for (const base of ["USD", "EUR"] as const) {
    const resp = await fetchWithTimeout(DOLARAPI[base], { headers: { accept: "application/json" } });
    if (!resp.ok) throw new Error(`DolarAPI ${base} HTTP ${resp.status}`);
    const payload = await resp.json();
    const rows: Record<string, unknown>[] = Array.isArray(payload) ? payload : [payload];
    const row = rows.find((r) => String(r?.fuente ?? "").toLowerCase() === "oficial");
    if (!row) throw new Error(`DolarAPI ${base}: sin fila oficial`);
    const updated = typeof row.fechaActualizacion === "string" ? row.fechaActualizacion : new Date().toISOString();
    out.push({ source: "dolarapi", base, rate: parseRate(String(row.promedio)), effectiveDate: caracasDate(updated), raw: row });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Método no permitido" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const authorization = req.headers.get("Authorization") ?? "";
  const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: userData } = await asCaller.auth.getUser();
  if (!userData.user) return json(401, { error: "Sesión requerida" });

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const { data: last } = await admin
    .from("exchange_rates")
    .select("fetched_at")
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (last && Date.now() - new Date(last.fetched_at).getTime() < MIN_INTERVAL_MS) {
    return json(200, { ok: true, skipped: true });
  }

  const errors: string[] = [];
  let rates: Rate[] = [];
  for (const source of [fromBcv, fromDolarApi]) {
    try {
      rates = await source();
      break;
    } catch (err) {
      errors.push((err as Error).message + (bcvClientError ? ` [cliente TLS: ${bcvClientError}]` : ""));
    }
  }
  if (rates.length === 0) return json(502, { ok: false, errors });

  const { error } = await admin.from("exchange_rates").upsert(
    rates.map((r) => ({
      source: r.source,
      base_currency: r.base,
      quote_currency: "VES",
      rate: r.rate,
      effective_date: r.effectiveDate,
      fetched_at: new Date().toISOString(),
      raw: r.raw,
    })),
    { onConflict: "source,base_currency,quote_currency,effective_date" },
  );
  if (error) return json(500, { ok: false, errors: [...errors, error.message] });

  return json(200, {
    ok: true,
    source: rates[0].source,
    rates: rates.map((r) => ({ base: r.base, rate: r.rate, effective_date: r.effectiveDate })),
    errors,
  });
});
