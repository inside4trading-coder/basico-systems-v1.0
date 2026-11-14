/** Tarjeta de Inicio: «Pregúntale a [B]eto». Al preguntar, abre /beto con la pregunta. */
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
    <section className="grid items-center gap-6 overflow-hidden rounded-surface bg-[radial-gradient(60%_80%_at_85%_10%,rgba(106,75,255,0.45),transparent_70%),radial-gradient(55%_70%_at_10%_100%,rgba(11,55,255,0.40),transparent_70%),linear-gradient(135deg,#0a0d12_0%,#020c42_100%)] p-5 text-white md:grid-cols-[1fr_minmax(0,28rem)] md:p-8">
      <div className="space-y-4">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/5 px-3 py-1 text-xs text-white/80">
          <BetoIcon className="h-3.5 w-3.5 text-betoIndigo300" aria-hidden /> Conoce a {BETO_NAME} · tu asistente IA
        </span>
        <h2 className="text-3xl font-bold leading-tight md:text-4xl">
          Pregúntale a{" "}
          <BetoWordmark tone="dark" />
          ,<br />
          él trabaja por ti
        </h2>
        <p className="max-w-md text-sm text-white/75">
          {BETO_NAME} conoce tu inventario, tus ventas, tus clientes y tus cuentas. Hazle preguntas en lenguaje natural y obtén respuestas y
          recomendaciones al instante.
        </p>
        <ul className="grid max-w-md grid-cols-2 gap-x-4 gap-y-1 text-sm text-white/75">
          {FEATURES.map((f) => (
            <li key={f}>· {f}</li>
          ))}
        </ul>
      </div>
      <div className="space-y-3 rounded-surface bg-[linear-gradient(135deg,#e8edff_0%,#efecff_55%,#ffffff_100%)] p-4 text-foreground shadow-lg">
        <BetoGreeting compact />
        <Composer access={access} onSend={ask} />
        <Suggestions access={access} onPick={ask} />
      </div>
    </section>
  );
}
