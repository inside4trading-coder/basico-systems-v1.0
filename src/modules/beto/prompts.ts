/**
 * Preguntas sugeridas y biblioteca de prompts de [B]eto. Cada una dice qué
 * permiso necesita para que nadie vea una pregunta que [B]eto no le puede
 * responder (la base igual lo hace cumplir).
 */
export type PromptNeed = "reportes" | "finanzas";

export interface BetoPrompt {
  text: string;
  needs: PromptNeed[];
}

export interface Suggestion extends BetoPrompt {
  icon: "box" | "cart" | "wallet" | "chart" | "flag";
}

export const SUGGESTIONS: Suggestion[] = [
  { icon: "box", text: "¿Qué productos están por agotarse?", needs: ["reportes"] },
  { icon: "cart", text: "¿Cómo van mis ventas hoy?", needs: ["reportes"] },
  { icon: "wallet", text: "¿Cuánto dinero tengo disponible?", needs: ["finanzas"] },
  { icon: "chart", text: "¿Cuánta utilidad generé este mes?", needs: ["reportes", "finanzas"] },
];

/** Mientras el negocio está arrancando: preguntas de cómo usar el sistema (las responde con guías). */
export const ONBOARDING_SUGGESTIONS: Suggestion[] = [
  { icon: "flag", text: "¿Por dónde empiezo a configurar mi negocio?", needs: [] },
  { icon: "box", text: "¿Cómo cargo mi inventario desde Excel?", needs: [] },
  { icon: "wallet", text: "¿Cómo registro una compra a crédito de un proveedor?", needs: [] },
  { icon: "cart", text: "¿Cómo abro la caja y hago mi primera venta?", needs: [] },
];

export const PROMPT_LIBRARY: { area: string; prompts: BetoPrompt[] }[] = [
  {
    area: "Cómo usar el sistema",
    prompts: [
      { text: "¿Por dónde empiezo a configurar mi negocio?", needs: [] },
      { text: "¿Cómo cargo mi inventario desde Excel?", needs: [] },
      { text: "¿Cómo registro una compra a crédito de un proveedor con su mercancía?", needs: [] },
      { text: "¿Dónde veo lo que le debo a cada proveedor y cómo le pago?", needs: [] },
      { text: "¿Cómo registro una venta a crédito y luego el cobro?", needs: [] },
      { text: "¿Cómo abro y cierro la caja?", needs: [] },
      { text: "¿Cómo invito a mi equipo y le doy permisos?", needs: [] },
      { text: "¿Por qué el sistema usa la tasa de otro día?", needs: [] },
    ],
  },
  {
    area: "Ventas",
    prompts: [
      { text: "Resume mis ventas de esta semana contra la semana pasada", needs: ["reportes"] },
      { text: "¿Cuáles fueron mis 10 productos más vendidos del mes?", needs: ["reportes"] },
      { text: "¿A qué hora y qué día de la semana vendo más?", needs: ["reportes"] },
      { text: "Proyecta mis ventas de los próximos 30 días", needs: ["reportes"] },
      { text: "¿Cómo cerraría el mes si sigo vendiendo igual?", needs: ["reportes"] },
    ],
  },
  {
    area: "Inventario",
    prompts: [
      { text: "¿Qué debería comprar esta semana y a qué proveedor?", needs: ["reportes"] },
      { text: "¿Qué productos tengo sin moverse hace más de 60 días?", needs: ["reportes"] },
      { text: "¿Cuánto vale mi inventario a costo y a precio de venta?", needs: ["reportes"] },
      { text: "¿Qué productos tengo agotados?", needs: ["reportes"] },
      { text: "¿Qué mercancía entró esta semana y de qué proveedor?", needs: [] },
    ],
  },
  {
    area: "Finanzas",
    prompts: [
      { text: "¿Cómo se ve mi flujo de caja de las próximas 4 semanas?", needs: ["reportes", "finanzas"] },
      { text: "¿Qué pagos a proveedores tengo vencidos o por vencer?", needs: ["finanzas"] },
      { text: "¿Cuánto me deben y cuánto está vencido?", needs: ["finanzas"] },
      { text: "¿A quién le debo, cuánto y qué factura vence primero?", needs: ["finanzas"] },
      { text: "¿Me alcanza el dinero para la compra sugerida?", needs: ["reportes", "finanzas"] },
      { text: "Dame mi estado de resultados del mes pasado", needs: ["reportes", "finanzas"] },
    ],
  },
  {
    area: "Clientes",
    prompts: [
      { text: "¿Quiénes son mis 10 mejores clientes de los últimos 90 días?", needs: ["reportes"] },
      { text: "¿Qué parte de mis ventas no tiene cliente registrado?", needs: ["reportes"] },
    ],
  },
];

export type PromptAccess = Record<PromptNeed, boolean>;

export function allowedPrompt(prompt: BetoPrompt, access: PromptAccess): boolean {
  return prompt.needs.every((n) => access[n]);
}

/** Biblioteca filtrada por permisos; las áreas vacías no se muestran. */
export function promptLibrary(access: PromptAccess) {
  return PROMPT_LIBRARY.map((g) => ({ area: g.area, prompts: g.prompts.filter((p) => allowedPrompt(p, access)) })).filter((g) => g.prompts.length > 0);
}
