/**
 * Marca de [B]eto, el asistente: nombre, wordmark, icono y degradado.
 *
 * El nombre se escribe siempre «[B]eto», sin excepciones. En texto plano
 * (placeholder, aria-label, toasts) se usa BETO_NAME; en pantalla, el
 * wordmark. Colores: escala azul del manual de marca más el índigo
 * secundario de [B]eto (tokens --beto-indigo*), nunca violeta, fucsia ni
 * rosa (el rosa es solo para alertas).
 */
import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

export const BETO_NAME = "[B]eto";

/** Degradado de [B]eto: azul de marca oscuro, azul de marca e índigo. */
export const BETO_GRADIENT = "bg-[linear-gradient(135deg,#020c42_0%,#0b37ff_55%,#6a4bff_100%)]";

/** Texto con el degradado claro (sobre fondo blanco). */
export const BETO_TEXT_GRADIENT = "bg-[linear-gradient(90deg,#0b37ff,#6a4bff)] bg-clip-text text-transparent";

const BRACKET = { fontWeight: 500 } as const;
// Mismas métricas que BrandMark: centran ópticamente la B entre los corchetes.
const LETTER_B = { fontSize: "0.85em", position: "relative", top: "-0.061em" } as const;

/**
 * Wordmark «[B]eto» en Chakra Petch. Nunca se transforma a mayúsculas, aunque
 * esté dentro de un título en mayúsculas.
 */
export function BetoWordmark({ tone = "light", className }: { tone?: "light" | "dark"; className?: string }) {
  const accent =
    tone === "dark"
      ? "bg-[linear-gradient(90deg,#b8c6ff,#a99bff)] bg-clip-text text-transparent"
      : BETO_TEXT_GRADIENT;
  return (
    <span
      className={cn("inline-flex items-baseline whitespace-nowrap font-display font-bold normal-case tracking-normal", className)}
      aria-label={BETO_NAME}
      role="img"
    >
      <span className={cn("inline-flex items-baseline", accent)} aria-hidden>
        <span style={BRACKET}>[</span>
        <span style={LETTER_B}>B</span>
        <span style={BRACKET}>]</span>
      </span>
      <span aria-hidden className={tone === "dark" ? "text-white" : undefined}>
        eto
      </span>
    </span>
  );
}

/**
 * Icono de [B]eto: el isotipo [B] dentro de una ficha redondeada, en el color
 * del texto (currentColor), como los iconos de lucide del menú.
 */
export function BetoIcon({ className, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} {...rest}>
      <rect x="2.5" y="2.5" width="19" height="19" rx="6" stroke="currentColor" strokeWidth="1.8" />
      <BracketB fill="currentColor" />
    </svg>
  );
}

/** [B] dibujado con trazos, para que no dependa de que la fuente esté cargada. */
function BracketB({ fill }: { fill: string }) {
  return (
    <g fill={fill}>
      {/* [ */}
      <path d="M6.6 7.4h2.3v1.3H8v6.6h.9v1.3H6.6z" />
      {/* ] */}
      <path d="M17.4 7.4h-2.3v1.3h.9v6.6h-.9v1.3h2.3z" />
      {/* B */}
      <path
        fillRule="evenodd"
        d="M9.9 8h2.6c1.3 0 2.1.7 2.1 1.7 0 .6-.3 1.1-.8 1.3.7.2 1.1.8 1.1 1.5 0 1.1-.9 1.9-2.3 1.9H9.9zm1.4 1.2v1.4h1.1c.5 0 .8-.3.8-.7s-.3-.7-.8-.7zm0 2.5v1.5h1.3c.5 0 .8-.3.8-.75s-.3-.75-.8-.75z"
      />
    </g>
  );
}

/** Ficha de [B]eto con el degradado y el [B] en blanco. */
export function BetoAvatar({ size = "md", className }: { size?: "sm" | "md" | "lg"; className?: string }) {
  const box = size === "lg" ? "h-14 w-14 rounded-2xl" : size === "md" ? "h-8 w-8 rounded-[10px]" : "h-6 w-6 rounded-lg";
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center text-white shadow-sm", BETO_GRADIENT, box, className)} aria-hidden>
      <svg viewBox="4.5 5 15 14" className="h-[72%] w-[72%]">
        <BracketB fill="currentColor" />
      </svg>
    </span>
  );
}
