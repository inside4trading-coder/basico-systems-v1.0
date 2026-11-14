/**
 * Conversación con [B]eto: sin conversación abierta, el saludo con la caja y las
 * sugerencias; con conversación, los mensajes y la caja abajo. La usan la
 * página /beto y el panel flotante.
 */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/core/auth";
import { cn } from "@/lib/utils";
import { firstName } from "@/modules/home/lib";
import { useBetoMessages, useBetoPromptAccess, useBetoUsage, useSendBeto } from "./api";
import { Composer, MessageView, Suggestions, Thinking } from "./BetoParts";
import { BETO_NAME, BETO_TEXT_GRADIENT, BetoAvatar } from "./brand";

export function BetoGreeting({ compact }: { compact?: boolean }) {
  const { session } = useAuth();
  const name = firstName(session?.user.user_metadata, session?.user.email);
  return (
    <div className={cn("flex flex-col items-center gap-2 text-center", compact ? "py-2" : "py-4")}>
      <BetoAvatar size="lg" />
      <h2 className="text-2xl">
        Hola
        {name && (
          <>
            ,{" "}
            <span className={cn("font-bold", BETO_TEXT_GRADIENT)}>{name}</span>
          </>
        )}
      </h2>
      <p className="text-sm text-muted-foreground">¿En qué puedo ayudarte con tu negocio hoy?</p>
    </div>
  );
}

export default function BetoChat({
  conversationId,
  onConversationChange,
  initialAsk,
  compact,
}: {
  conversationId: string | null;
  onConversationChange: (id: string | null) => void;
  /** Pregunta que llega desde la tarjeta de Inicio: se envía una vez al abrir. */
  initialAsk?: string | null;
  compact?: boolean;
}) {
  const access = useBetoPromptAccess();
  const location = useLocation();
  const { data: messages = [], isLoading } = useBetoMessages(conversationId);
  const { data: usage } = useBetoUsage();
  const send = useSendBeto();
  const [pendingText, setPendingText] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const askedInitial = useRef(false);

  const ask = (text: string) => {
    if (send.isPending) return;
    setPendingText(text);
    send.mutate(
      { conversationId, message: text, page: location.pathname },
      {
        onSuccess: (answer) => {
          if (answer.conversation_id !== conversationId) onConversationChange(answer.conversation_id);
        },
        onError: (err) => {
          const conv = (err as Error & { conversationId?: string | null }).conversationId;
          if (conv && conv !== conversationId) onConversationChange(conv);
          toast.error(`${BETO_NAME} no pudo responder`, { description: err.message });
        },
        onSettled: () => setPendingText(null),
      },
    );
  };

  useEffect(() => {
    if (initialAsk && !askedInitial.current) {
      askedInitial.current = true;
      ask(initialAsk);
    }
    // Solo al montar con una pregunta de Inicio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAsk]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, pendingText]);

  const left = usage ? usage.limit - usage.used : null;
  // Mientras se envía, la pregunta se muestra al momento (la base la guarda igual).
  const shownPending = pendingText !== null && !messages.some((m) => m.role === "assistant" && m.status === "pendiente");
  const empty = !conversationId && pendingText === null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {empty ? (
        <div className="space-y-4">
          <BetoGreeting compact={compact} />
          <Composer access={access} onSend={ask} busy={send.isPending} autoFocus={!compact} />
          <Suggestions access={access} onPick={ask} disabled={send.isPending} />
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1" aria-live="polite">
            {isLoading && <p className="mono-cap text-xs text-muted-foreground">Cargando…</p>}
            {messages.map((m) => (
              <MessageView key={m.id} message={m} />
            ))}
            {shownPending && (
              <>
                <MessageView message={{ role: "user", content: pendingText, blocks: null, status: "listo" }} />
                <Thinking />
              </>
            )}
            <div ref={bottom} />
          </div>
          <Composer access={access} onSend={ask} busy={send.isPending} autoFocus />
        </>
      )}
      {left !== null && left <= 20 && (
        <p className="text-center text-xs text-muted-foreground">
          {left > 0 ? `Te quedan ${left} preguntas este mes.` : "Ya usaste las preguntas de este mes. Escríbenos para ampliarlo."}
        </p>
      )}
      <p className="text-center text-[11px] text-muted-foreground">{BETO_NAME} puede equivocarse. Revisa las cifras importantes en Reportes y Administración.</p>
    </div>
  );
}
