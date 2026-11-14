/** /beto: historial de conversaciones y la conversación abierta. */
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { History, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useBetoConversations, useBetoUsage, useDeleteBetoConversation, type BetoConversation } from "./api";
import BetoChat from "./BetoChat";
import { BetoWordmark } from "./brand";

const dayFormat = new Intl.DateTimeFormat("es-VE", { day: "numeric", month: "short", timeZone: "America/Caracas" });

function ConversationList({
  conversations,
  current,
  onPick,
  onNew,
}: {
  conversations: BetoConversation[];
  current: string | null;
  onPick: (id: string) => void;
  onNew: () => void;
}) {
  const remove = useDeleteBetoConversation();
  return (
    <div className="space-y-2">
      <Button variant="outline" className="w-full justify-start gap-2" onClick={onNew}>
        <Plus className="h-4 w-4" /> Nueva conversación
      </Button>
      {conversations.length === 0 && <p className="px-1 text-xs text-muted-foreground">Tus conversaciones aparecen aquí. Solo tú las ves.</p>}
      <ul className="space-y-1">
        {conversations.map((c) => (
          <li key={c.id} className="group flex items-center gap-1">
            <button
              type="button"
              onClick={() => onPick(c.id)}
              className={cn("min-w-0 flex-1 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted", c.id === current && "bg-muted font-semibold")}
            >
              <span className="block truncate">{c.title}</span>
              <span className="text-[11px] text-muted-foreground">{dayFormat.format(new Date(c.updated_at))}</span>
            </button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0 opacity-60 hover:opacity-100"
              aria-label={`Borrar «${c.title}»`}
              disabled={remove.isPending}
              onClick={() => {
                if (!window.confirm("¿Borrar esta conversación?")) return;
                remove.mutate(c.id, {
                  onSuccess: () => c.id === current && onNew(),
                  onError: (err) => toast.error("No se pudo borrar", { description: err.message }),
                });
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function BetoPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const initialAsk = (location.state as { ask?: string } | null)?.ask ?? null;
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [chatKey, setChatKey] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const { data: conversations = [] } = useBetoConversations();
  const { data: usage } = useBetoUsage();

  // La pregunta de Inicio se usa una vez: se limpia del historial del navegador.
  useEffect(() => {
    if (initialAsk) navigate(location.pathname, { replace: true, state: null });
  }, [initialAsk, navigate, location.pathname]);

  const pick = (id: string) => {
    setConversationId(id);
    setHistoryOpen(false);
  };
  const startNew = () => {
    setConversationId(null);
    setChatKey((k) => k + 1);
    setHistoryOpen(false);
  };

  const list = <ConversationList conversations={conversations} current={conversationId} onPick={pick} onNew={startNew} />;

  return (
    <AppShell wide>
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl">
            Pregúntale a <BetoWordmark />
          </h1>
          <p className="text-sm text-muted-foreground">Él trabaja por ti: ventas, inventario, dinero, proyecciones y compras.</p>
        </div>
        <div className="flex items-center gap-2">
          {usage && (
            <span className="mono-cap hidden text-[10px] text-muted-foreground sm:inline">
              {usage.used} de {usage.limit} este mes
            </span>
          )}
          <Button size="sm" variant="outline" className="gap-1.5 lg:hidden" onClick={() => setHistoryOpen(true)}>
            <History className="h-4 w-4" /> Historial
          </Button>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <aside className="hidden lg:block">{list}</aside>
        <section className="mx-auto flex h-[calc(100vh-13rem)] min-h-[28rem] w-full max-w-3xl flex-col">
          <BetoChat key={chatKey} conversationId={conversationId} onConversationChange={setConversationId} initialAsk={initialAsk} />
        </section>
      </div>
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="left" className="w-80 overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Conversaciones</SheetTitle>
          </SheetHeader>
          <div className="mt-4">{list}</div>
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}
