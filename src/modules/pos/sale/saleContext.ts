/**
 * Origen y modalidad de la venta: se eligen antes de armar el carrito y viajan
 * con él (borrador, carritos en espera y cola sin conexión).
 */
import type { SaleCustomer } from "@/modules/customers/api";
import type { SalesChannel } from "@/modules/settings/api";
import { deliveryProblems, DELIVERY_LABELS, type DeliveryData } from "../delivery/parse";

export type Fulfillment = "pickup" | "envio";

export interface SaleContext {
  channelId: string;
  channelName: string;
  requiresFulfillment: boolean;
  fulfillment: Fulfillment | null;
  /** Datos del destinatario; se pueden llenar durante la venta. */
  delivery: DeliveryData | null;
  /** Cliente de la ficha asociado desde el envío (por cédula). */
  customer?: SaleCustomer | null;
}

export const FULFILLMENT_LABELS: Record<Fulfillment, string> = { pickup: "Retiro", envio: "Envío" };

/** Orígenes que se ofrecen en el POS: activos y nunca «Web» (las ventas web no pasan por caja). */
export function posChannels(channels: SalesChannel[]): SalesChannel[] {
  return channels
    .filter((c) => c.is_active && c.name.trim().toLowerCase() !== "web")
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

/** «WhatsApp · Envío · MRW» */
export function saleSummary(ctx: SaleContext): string {
  const parts = [ctx.channelName];
  if (ctx.fulfillment) parts.push(FULFILLMENT_LABELS[ctx.fulfillment]);
  if (ctx.fulfillment === "envio" && ctx.delivery?.carrier) parts.push(ctx.delivery.carrier);
  return parts.join(" · ");
}

/** Qué impide cobrar con este origen; null si está completo. */
export function saleContextProblem(ctx: SaleContext | null | undefined): string | null {
  if (!ctx) return "Elige el origen de la venta.";
  if (ctx.requiresFulfillment && !ctx.fulfillment) return "Elige si la venta es para retirar o para enviar.";
  if (ctx.fulfillment === "envio") {
    const missing = ctx.delivery ? deliveryProblems(ctx.delivery) : (Object.keys(DELIVERY_LABELS) as (keyof DeliveryData)[]);
    if (missing.length) return `Completa los datos del envío: ${missing.map((f) => DELIVERY_LABELS[f]).join(", ")}.`;
  }
  return null;
}

/** Contexto nuevo al elegir un origen (o al cambiarlo): conserva lo que sigue valiendo. */
export function pickChannel(prev: SaleContext | null | undefined, channel: SalesChannel, fulfillment: Fulfillment | null): SaleContext {
  const requires = Boolean(channel.requires_fulfillment);
  const mode = requires ? fulfillment : null;
  return {
    channelId: channel.id,
    channelName: channel.name,
    requiresFulfillment: requires,
    fulfillment: mode,
    delivery: mode === "envio" ? (prev?.delivery ?? null) : null,
    customer: prev?.customer ?? null,
  };
}
