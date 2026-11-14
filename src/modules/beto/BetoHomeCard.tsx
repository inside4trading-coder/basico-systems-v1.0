/**
 * Tarjeta de Inicio: «Pregúntale a [B]eto». Compacta para que el inicio se vea
 * completo sin bajar: título a la izquierda, caja y sugerencias a la derecha.
 * Al preguntar, abre /beto con la pregunta.
 */
import { useNavigate } from "react-router-dom";
import { useBetoAccess, useBetoPromptAccess } from "./api";
import { BetoGreeting } from "./BetoChat";
import { Composer, Suggestions } from "./BetoParts";
import { BETO_NAME, BetoIcon, BetoWordmark } from "./brand";

const FEATURES = ["Proyecciones de ventas", "Recomendaciones de compra", "Análisis de clientes", "Reportes en segundos"];

export default function BetoHomeCard() {
  const allowed = useBetoAccess();
  const access = useBetoPromptAccess();
  const navigate = useNavigate();
  if (!allowed) return null;

  const ask = (text: string) => navigate("/beto", { state: { ask: text } });

  return (
    <section className="grid items-center gap-4 overflow-hidden rounded-surface bg-[radial-gradient(60%_90%_at_85%_0%,rgba(106,75,255,0.45),transparent_70%),radial-gradient(55%_80%_at_5%_100%,rgba(11,55,255,0.40),transparent_70%),linear-gradient(135deg,#0a0d12_0%,#020c42_100%)] p-4 text-white lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] md:p-5 lg:gap-6">
      <div className="space-y-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/5 px-2.5 py-0.5 text-[11px] text-white/80">
          <BetoIcon className="h-3.5 w-3.5 text-betoIndigo300" aria-hidden /> Conoce a {BETO_NAME} · tu asistente IA
        </span>
        <h2 className="text-xl font-bold leading-tight md:text-2xl lg:text-3xl">
          Pregúntale a <BetoWordmark tone="dark" />, <br className="hidden lg:block" />
          él trabaja por ti
        </h2>
        <p className="hidden max-w-md text-xs text-white/70 sm:block">
          Conoce tu inventario, tus ventas, tus clientes y tus cuentas. Pregúntale en lenguaje natural y obtén respuestas al instante.
        </p>
        <p className="hidden text-[11px] text-white/60 lg:block">{FEATURES.join(" · ")}</p>
      </div>
      <div className="space-y-2.5 rounded-surface bg-[linear-gradient(135deg,#e8edff_0%,#efecff_55%,#ffffff_100%)] p-3 text-foreground shadow-lg">
        <BetoGreeting row />
        <Composer access={access} onSend={ask} compact />
        <Suggestions access={access} onPick={ask} compact />
      </div>
    </section>
  );
}
