// [B]eto, el asistente de IA: responde preguntas del negocio con datos reales.
//
//   1. Con la sesión de quien pregunta, beto_start valida add-on, permiso,
//      cuota y ritmo, guarda la pregunta y devuelve el contexto e historial.
//   2. Se llama al modelo (OpenRouter, chat con herramientas). Cada
//      herramienta es una RPC de lectura de firma fija que corre con la misma
//      sesión: RLS, negocio activo y permisos se heredan.
//   3. beto_finish (solo service_role) guarda la respuesta, tokens y costo;
//      las fallidas no gastan cuota.
// Secretos (en Supabase, nunca en Vercel ni en el repo): OPENROUTER_API_KEY
// (la misma del Estudio) y, opcional, BETO_MODEL.

import { createClient } from "npm:@supabase/supabase-js@2.99.3";
import { buildSystemPrompt, resolveTool, toolSchemas, trimResult, type BetoContext, type Kpi } from "../_shared/beto-tools.ts";

const DEFAULT_MODEL = "google/gemini-2.5-flash";
const MAX_ROUNDS = 5;
const MAX_CALLS_PER_ROUND = 4;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Siempre 200 con { error }: así la app muestra el motivo.
function json(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" });

  const authorization = req.headers.get("Authorization");
  const tenantId = req.headers.get("x-tenant-id") ?? "";
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Sesión requerida" });
  if (!UUID_RE.test(tenantId)) return json({ error: "Negocio no indicado" });

  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) return json({ error: "[B]eto no está configurado todavía. Avisa a soporte." });
  const model = Deno.env.get("BETO_MODEL") || DEFAULT_MODEL;
  const apiUrl = Deno.env.get("BETO_API_URL") || "https://openrouter.ai/api/v1/chat/completions";

  let body: { conversation_id?: unknown; message?: unknown; page?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" });
  }
  const conversationId = typeof body.conversation_id === "string" && UUID_RE.test(body.conversation_id) ? body.conversation_id : null;
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const page = typeof body.page === "string" && /^\/[\w\-/]{0,80}$/.test(body.page) ? body.page : null;

  const url = Deno.env.get("SUPABASE_URL")!;
  const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization, "x-tenant-id": tenantId } },
    auth: { persistSession: false },
  });
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // 1. Permisos, cuota y contexto (con la sesión de quien pregunta).
  const { data: start, error: startError } = await asCaller.rpc("beto_start", { p_conversation_id: conversationId, p_message: message });
  if (startError || !start?.message_id) return json({ error: startError?.message ?? "No se pudo iniciar" });
  const ctx = start as BetoContext & { conversation_id: string; message_id: string; history: { role: "user" | "assistant"; content: string }[] };

  const tools: string[] = [];
  let blocks: Kpi[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let cost: number | null = null;

  const finish = async (ok: boolean, text: string, error: string | null) => {
    await admin.rpc("beto_finish", {
      p_message_id: ctx.message_id,
      p_ok: ok,
      p_content: text,
      p_blocks: blocks.length ? blocks : null,
      p_tools: [...new Set(tools)],
      p_model: model,
      p_tokens_in: tokensIn || null,
      p_tokens_out: tokensOut || null,
      p_cost: cost,
      p_error: error,
    });
  };
  const fail = async (userMessage: string, detail: string) => {
    await finish(false, "", detail);
    return json({ error: userMessage, conversation_id: ctx.conversation_id, message_id: ctx.message_id });
  };

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(ctx, page) },
    ...ctx.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];
  const schemas = toolSchemas(ctx);

  const callModel = async (allowTools: boolean) => {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        tools: schemas,
        tool_choice: allowTools ? "auto" : "none",
        temperature: 0.2,
        max_tokens: 1500,
        usage: { include: true },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw Object.assign(new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`), { status: res.status });
    }
    const data = await res.json();
    tokensIn += data?.usage?.prompt_tokens ?? 0;
    tokensOut += data?.usage?.completion_tokens ?? 0;
    if (typeof data?.usage?.cost === "number") cost = (cost ?? 0) + data.usage.cost;
    return data?.choices?.[0]?.message as ChatMessage | undefined;
  };

  try {
    // 2. Modelo y herramientas.
    let answer = "";
    for (let round = 0; round <= MAX_ROUNDS; round++) {
      const reply = await callModel(round < MAX_ROUNDS);
      if (!reply) return await fail("[B]eto no pudo responder. Intenta de nuevo.", "Respuesta vacía del modelo");
      const calls = (reply.tool_calls ?? []).slice(0, MAX_CALLS_PER_ROUND);
      if (calls.length === 0 || round === MAX_ROUNDS) {
        answer = (reply.content ?? "").trim();
        break;
      }
      messages.push({ role: "assistant", content: reply.content ?? null, tool_calls: calls });
      for (const call of calls) {
        const action = resolveTool(call.function?.name ?? "", call.function?.arguments, ctx);
        let result: string;
        if (!action) {
          result = JSON.stringify({ error: "Herramienta no disponible para este usuario" });
        } else if (action.kind === "kpis") {
          blocks = action.kpis;
          tools.push(call.function.name);
          result = JSON.stringify({ ok: true });
        } else if (action.kind === "locations") {
          tools.push(call.function.name);
          const { data, error } = await asCaller.from("locations").select("id, name, type").is("deleted_at", null).order("name");
          result = error ? JSON.stringify({ error: error.message }) : trimResult(data);
        } else {
          tools.push(call.function.name);
          const { data, error } = await asCaller.rpc(action.fn, action.params);
          result = error ? JSON.stringify({ error: error.message }) : trimResult(data);
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
      }
    }
    if (!answer) return await fail("[B]eto no pudo armar la respuesta. Intenta con otra pregunta.", "Sin texto final");

    // 3. Guardar y responder.
    await finish(true, answer, null);
    return json({ conversation_id: ctx.conversation_id, message_id: ctx.message_id, text: answer, blocks });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 429) return await fail("[B]eto está ocupado. Intenta en un minuto.", (err as Error).message);
    if (status === 402) return await fail("[B]eto no tiene saldo. Avisa a soporte.", (err as Error).message);
    if ((err as Error).name === "TimeoutError") return await fail("[B]eto tardó demasiado. Intenta con una pregunta más corta.", "Timeout");
    return await fail("[B]eto no pudo responder. Intenta de nuevo.", (err as Error).message);
  }
});
