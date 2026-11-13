// Actualiza la tasa oficial USD/VES y EUR/VES en exchange_rates.
//
// Port de supabase/functions/sublime-bcv-rate (basicosystems@f551478b):
//   * Fuente principal: la página del BCV, que publica la "fecha valor" (el
//     día desde el que rige la tasa). Su servidor envía mal la cadena de
//     certificados, así que se le agrega el intermedio correcto
//     (_shared/bcv-ca.ts) solo para esa petición.
//   * Respaldo: DolarAPI, que replica la tasa oficial con la misma fecha valor.
//   * Sin tasa manual aquí: la tasa propia o de emergencia del negocio va en
//     tenant_rates y solo la escribe quien tiene config.negocio.
//
// Modos (body.mode):
//   * auto (por defecto): la app al abrirse. No consulta si hubo una tasa
//     guardada hace menos de 30 minutos o un intento hace menos de 10.
//   * cron: la consulta programada (pg_cron + pg_net, sin sesión). Mismos límites.
//   * refresh: «Actualizar ahora». Con sesión; no antes de 2 minutos del último intento.
//   * test: «Probar conexión». Con sesión; consulta las dos fuentes y no guarda nada.
// Cada intento queda en rate_fetch_log. Solo lee fuentes públicas y no recibe
// valores del cliente: por eso auto y cron aceptan llamadas sin sesión
// (verify_jwt desactivado en config.toml).

import { createClient } from "npm:@supabase/supabase-js@2.99.3";
import { caracasDate, parseBcvHtml, parseRate, type Rate } from "../_shared/bcv.ts";
import { BCV_INTERMEDIATE_CA } from "../_shared/bcv-ca.ts";

const BCV_URL = "https://www.bcv.org.ve/";
const DOLARAPI = { USD: "https://ve.dolarapi.com/v1/dolares", EUR: "https://ve.dolarapi.com/v1/euros" };
const FRESH_MS = 30 * 60 * 1000;
const AUTO_RETRY_MS = 10 * 60 * 1000;
const REFRESH_RETRY_MS = 2 * 60 * 1000;
const TIMEOUT_MS = 8000;

type Mode = "auto" | "cron" | "refresh" | "test";
const MODES: Mode[] = ["auto", "cron", "refresh", "test"];

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
  } catch (err) {
    throw new Error((err as Error).name === "AbortError" ? "no respondió a tiempo" : (err as Error).message);
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
  try {
    const client = bcvClient();
    const resp = await fetchWithTimeout(BCV_URL, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; BasicoSystems/1.0)" },
      ...(client ? { client } : {}),
    } as RequestInit);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return parseBcvHtml(await resp.text());
  } catch (err) {
    throw new Error(`BCV: ${(err as Error).message}${bcvClientError ? ` [cliente TLS: ${bcvClientError}]` : ""}`);
  }
}

async function fromDolarApi(): Promise<Rate[]> {
  const out: Rate[] = [];
  for (const base of ["USD", "EUR"] as const) {
    try {
      const resp = await fetchWithTimeout(DOLARAPI[base], { headers: { accept: "application/json" } });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const payload = await resp.json();
      const rows: Record<string, unknown>[] = Array.isArray(payload) ? payload : [payload];
      const row = rows.find((r) => String(r?.fuente ?? "").toLowerCase() === "oficial");
      if (!row) throw new Error("sin fila oficial");
      const updated = typeof row.fechaActualizacion === "string" ? row.fechaActualizacion : new Date().toISOString();
      out.push({ source: "dolarapi", base, rate: parseRate(String(row.promedio)), effectiveDate: caracasDate(updated), raw: row });
    } catch (err) {
      throw new Error(`DolarAPI ${base}: ${(err as Error).message}`);
    }
  }
  return out;
}

const usdOf = (rates: Rate[]) => rates.find((r) => r.base === "USD") ?? rates[0];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Método no permitido" });

  const body = await req.json().catch(() => ({}));
  const mode: Mode = MODES.includes(body?.mode) ? body.mode : "auto";

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  let userId: string | null = null;
  const authorization = req.headers.get("Authorization") ?? "";
  if (authorization.startsWith("Bearer ")) {
    const { data } = await admin.auth.getUser(authorization.slice(7));
    userId = data.user?.id ?? null;
  }
  if ((mode === "refresh" || mode === "test") && !userId) return json(401, { error: "Sesión requerida" });

  const log = (entry: { ok: boolean; source?: string; rate?: number; effective_date?: string; error?: string | null }) =>
    admin.from("rate_fetch_log").insert({
      mode,
      requested_by: userId,
      ...entry,
      error: entry.error ? entry.error.slice(0, 2000) : null,
    });

  // ---- Probar conexión: las dos fuentes, sin guardar. ----
  if (mode === "test") {
    const results = await Promise.all(
      [
        { name: "bcv", run: fromBcv },
        { name: "dolarapi", run: fromDolarApi },
      ].map(async (s) => {
        try {
          const usd = usdOf(await s.run());
          return { source: s.name, ok: true, rate: usd.rate, effective_date: usd.effectiveDate };
        } catch (err) {
          return { source: s.name, ok: false, error: (err as Error).message };
        }
      }),
    );
    const good = results.find((r) => r.ok);
    const errors = results.filter((r) => !r.ok).map((r) => r.error).join("; ");
    await log({ ok: Boolean(good), source: good?.source, rate: good?.rate, effective_date: good?.effective_date, error: errors || null });
    return json(200, { ok: Boolean(good), results });
  }

  // ---- Límites para no consultar de más. ----
  const now = Date.now();
  const [{ data: lastRate }, { data: lastTry }] = await Promise.all([
    admin.from("exchange_rates").select("fetched_at").order("fetched_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("rate_fetch_log").select("created_at").neq("mode", "test").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const since = (iso?: string | null) => (iso ? now - new Date(iso).getTime() : Infinity);
  if (mode === "refresh") {
    if (since(lastTry?.created_at) < REFRESH_RETRY_MS) return json(200, { ok: true, skipped: true, reason: "Se consultó hace menos de 2 minutos" });
  } else if (since(lastRate?.fetched_at) < FRESH_MS || since(lastTry?.created_at) < AUTO_RETRY_MS) {
    return json(200, { ok: true, skipped: true });
  }

  // ---- Consultar y guardar. ----
  const errors: string[] = [];
  let rates: Rate[] = [];
  for (const source of [fromBcv, fromDolarApi]) {
    try {
      rates = await source();
      break;
    } catch (err) {
      errors.push((err as Error).message);
    }
  }
  if (rates.length === 0) {
    await log({ ok: false, error: errors.join("; ") });
    return json(502, { ok: false, errors });
  }

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
  if (error) {
    await log({ ok: false, error: [...errors, `Guardar: ${error.message}`].join("; ") });
    return json(500, { ok: false, errors: [...errors, error.message] });
  }

  const usd = usdOf(rates);
  await log({ ok: true, source: usd.source, rate: usd.rate, effective_date: usd.effectiveDate, error: errors.join("; ") || null });

  return json(200, {
    ok: true,
    source: rates[0].source,
    rates: rates.map((r) => ({ base: r.base, rate: r.rate, effective_date: r.effectiveDate })),
    errors,
  });
});
