// Estudio de IA: genera una foto de producto con OpenRouter.
//
// Portado de estudio-generate-image (basicosystems@f551478b), sin rubro.
//   1. Con la sesión de quien llama, studio_start valida rol, add-on, cuota
//      del mes y que la foto de origen sea de la carpeta del negocio.
//   2. Se descarga la foto de origen, se llama a OpenRouter (endpoint de
//      imágenes) y el resultado se sube a product-images en la carpeta del
//      negocio.
//   3. studio_finish (solo service_role) guarda el resultado y el costo; los
//      fallidos no gastan cuota.
// Secretos (en Supabase, nunca en Vercel ni en el repo): OPENROUTER_API_KEY y,
// opcional, STUDIO_IMAGE_MODEL.

import { createClient } from "npm:@supabase/supabase-js@2.99.3";

const BUCKET = "product-images";
const DEFAULT_MODEL = "google/gemini-2.5-flash-image";
const KINDS = ["catalogo", "transparente", "ambientado"] as const;
type Kind = (typeof KINDS)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Siempre 200 con { error }: así supabase.functions.invoke no esconde el motivo.
function json(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const KEEP_PRODUCT =
  "Usa la foto adjunta como referencia exacta del producto: misma forma, proporciones, color, materiales, marca, " +
  "etiquetas y textos, sin inventar ni cambiar ningún detalle. Quita manos, personas, cables y el fondo original. " +
  "No agregues texto, logos ni marcas de agua.";

export function promptFor(kind: Kind, scene: string | null): string {
  switch (kind) {
    case "catalogo":
      return (
        "Fotografía profesional de producto para catálogo de tienda en línea. " +
        KEEP_PRODUCT +
        " Fondo blanco puro (#FFFFFF), liso y uniforme. Iluminación de estudio suave y pareja, sombra de contacto sutil " +
        "bajo el producto. Producto centrado, de frente, ocupando cerca del 80 % del encuadre, nítido y en alta resolución."
      );
    case "transparente":
      return (
        "Fotografía de producto para recortar. " +
        KEEP_PRODUCT +
        " Fondo verde croma puro (#00FF00) completamente liso y uniforme, sin sombras, reflejos, degradados ni texturas en el fondo. " +
        "Sin sombra proyectada. Iluminación de estudio pareja. Producto centrado, ocupando cerca del 80 % del encuadre, con bordes nítidos."
      );
    case "ambientado":
      return (
        "Fotografía publicitaria realista del producto en un ambiente. " +
        KEEP_PRODUCT +
        ` Ambiente: ${scene}. El producto es el protagonista: en foco, a escala real y bien iluminado; ` +
        "el fondo lo complementa sin distraer, con luz natural creíble y profundidad de campo suave."
      );
  }
}

async function toDataUrl(bytes: Uint8Array, type: string): Promise<string> {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(binary)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" });

  const authorization = req.headers.get("Authorization");
  const tenantId = req.headers.get("x-tenant-id") ?? "";
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Sesión requerida" });
  if (!UUID_RE.test(tenantId)) return json({ error: "Negocio no indicado" });

  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) return json({ error: "El Estudio no está configurado (falta la clave de OpenRouter)." });
  const model = Deno.env.get("STUDIO_IMAGE_MODEL") || DEFAULT_MODEL;

  let body: { product_id?: unknown; kind?: unknown; scene?: unknown; source_path?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" });
  }
  const productId = typeof body.product_id === "string" ? body.product_id : "";
  const kind = body.kind as Kind;
  const scene = typeof body.scene === "string" ? body.scene.trim().slice(0, 300) : null;
  const sourcePath = typeof body.source_path === "string" ? body.source_path : "";
  if (!UUID_RE.test(productId)) return json({ error: "Producto inválido" });
  if (!KINDS.includes(kind)) return json({ error: "Tipo de foto inválido" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization, "x-tenant-id": tenantId } },
    auth: { persistSession: false },
  });
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // 1. Permisos y cuota (con la sesión de quien llama).
  const { data: jobId, error: startError } = await asCaller.rpc("studio_start", {
    p_product_id: productId,
    p_kind: kind,
    p_scene: scene,
    p_source_path: sourcePath,
  });
  if (startError || typeof jobId !== "string") return json({ error: startError?.message ?? "No se pudo iniciar" });

  const fail = async (message: string, detail?: string) => {
    await admin.rpc("studio_finish", { p_job_id: jobId, p_ok: false, p_result_path: null, p_model: model, p_cost: null, p_error: detail ?? message });
    return json({ error: message, jobId });
  };

  try {
    // 2. Foto de origen.
    const { data: source, error: downloadError } = await admin.storage.from(BUCKET).download(sourcePath);
    if (downloadError || !source) return await fail("No se pudo leer la foto de origen.");
    const sourceUrl = await toDataUrl(new Uint8Array(await source.arrayBuffer()), source.type || "image/webp");

    // 3. OpenRouter.
    const aiRes = await fetch("https://openrouter.ai/api/v1/images", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: promptFor(kind, scene),
        input_references: [{ type: "image_url", image_url: { url: sourceUrl } }],
        aspect_ratio: "1:1",
        output_format: "png",
      }),
      signal: AbortSignal.timeout(150_000),
    });
    if (aiRes.status === 429) return await fail("El servicio de IA está ocupado. Intenta en unos minutos.", "OpenRouter 429");
    if (aiRes.status === 402) return await fail("El Estudio no tiene saldo. Avisa a soporte.", "OpenRouter 402");
    if (!aiRes.ok) {
      const text = await aiRes.text().catch(() => "");
      return await fail(`La generación falló (${aiRes.status}).`, `OpenRouter ${aiRes.status}: ${text.slice(0, 300)}`);
    }
    const ai = await aiRes.json();
    const b64 = ai?.data?.[0]?.b64_json as string | undefined;
    const mediaType = (ai?.data?.[0]?.media_type as string | undefined) ?? "image/png";
    const cost = typeof ai?.usage?.cost === "number" ? ai.usage.cost : null;
    if (!b64) return await fail("La IA no devolvió una imagen. Intenta con otra foto.", "Sin imagen en la respuesta");

    // 4. Resultado en la carpeta del negocio.
    const ext = mediaType.includes("webp") ? "webp" : mediaType.includes("jpeg") ? "jpg" : "png";
    const resultPath = `${tenantId}/${productId}/estudio-${jobId}.${ext}`;
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(resultPath, bytes, { contentType: mediaType, upsert: false });
    if (uploadError) return await fail("No se pudo guardar la imagen generada.", uploadError.message);

    await admin.rpc("studio_finish", { p_job_id: jobId, p_ok: true, p_result_path: resultPath, p_model: model, p_cost: cost, p_error: null });
    const publicUrl = admin.storage.from(BUCKET).getPublicUrl(resultPath).data.publicUrl;
    return json({ jobId, url: publicUrl, path: resultPath, kind });
  } catch (err) {
    return await fail("La generación falló. Intenta de nuevo.", (err as Error).message);
  }
});
