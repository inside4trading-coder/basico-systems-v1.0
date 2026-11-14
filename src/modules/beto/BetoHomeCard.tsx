/** Tarjeta de Inicio: «Pregúntale a Beto». Al preguntar, abre /beto con la pregunta. */
import { useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { useBetoAccess, useBetoPromptAccess } from "./api";
import { BetoGreeting } from "./BetoChat";
import { Composer, Suggestions } from "./BetoParts";

const FEATURES = ["Proyecciones de ventas", "Recomendaciones de compra", "Análisis de clientes", "Reportes en segundos"];

export default function BetoHomeCard() {
  const allowed = useBetoAccess();
  const access = useBetoPromptAccess();
  const navigate = useNavigate();
  if (!allowed) return null;

  const ask = (text: string) => navigate("/beto", { state: { ask: text } });

  return (
    <section className="grid items-center gap-6 overflow-hidden rounded-surface bg-gradient-to-br from-[#0A0D12] via-[#1b0b3a] to-[#3b0764] p-5 text-white md:grid-cols-[1fr_minmax(0,28rem)] md:p-8">
      <div className="space-y-4">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/5 px-3 py-1 text-xs text-white/80">
          <Sparkles className="h-3.5 w-3.5 text-fuchsia-300" aria-hidden /> Conoce a Beto · tu asistente IA
        </span>
        <h2 className="text-3xl font-bold leading-tight md:text-4xl">
          Pregúntale a{" "}
          <span className="font-display">
            <span className="bg-gradient-to-r from-violet-400 to-pink-400 bg-clip-text text-transparent">[B]</span>eto
          </span>
          ,<br />
          él trabaja por ti
        </h2>
        <p className="max-w-md text-sm text-white/75">
          Beto conoce tu inventario, tus ventas, tus clientes y tus cuentas. Hazle preguntas en lenguaje natural y obtén respuestas y
          recomendaciones al instante.
        </p>
        <ul className="grid max-w-md grid-cols-2 gap-x-4 gap-y-1 text-sm text-white/75">
          {FEATURES.map((f) => (
            <li key={f}>· {f}</li>
          ))}
        </ul>
      </div>
      <div className="space-y-3 rounded-surface bg-gradient-to-br from-violet-100 via-fuchsia-50 to-pink-100 p-4 text-foreground shadow-lg">
        <BetoGreeting compact />
        <Composer access={access} onSend={ask} />
        <Suggestions access={access} onPick={ask} />
      </div>
    </section>
  );
}
