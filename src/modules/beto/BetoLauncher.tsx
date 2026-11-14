/** Botón flotante: abre a Beto en un panel lateral desde cualquier pantalla. */
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Maximize2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useBetoAccess } from "./api";
import BetoChat from "./BetoChat";
import { BETO_GRADIENT, BetoAvatar, BetoWordmark } from "./BetoParts";

export default function BetoLauncher() {
  const allowed = useBetoAccess();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [chatKey, setChatKey] = useState(0);

  if (!allowed || pathname.startsWith("/beto")) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Preguntarle a Beto"
        title="Preguntarle a Beto"
        className={cn(
          "fixed bottom-4 right-4 z-40 inline-flex h-12 items-center gap-2 rounded-full pl-2 pr-4 text-sm font-semibold text-white shadow-lg transition-transform hover:scale-105 motion-reduce:transition-none",
          BETO_GRADIENT,
        )}
      >
        <BetoAvatar size="md" /> Beto
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-3 sm:max-w-md">
          <SheetHeader className="flex-row items-center justify-between space-y-0 pr-8">
            <SheetTitle>
              <BetoWordmark className="text-lg" />
            </SheetTitle>
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                aria-label="Nueva conversación"
                title="Nueva conversación"
                onClick={() => {
                  setConversationId(null);
                  setChatKey((k) => k + 1);
                }}
              >
                <Plus className="h-4 w-4" />
              </Button>
              <Button asChild size="icon" variant="ghost" className="h-8 w-8" aria-label="Abrir en pantalla completa" title="Abrir en pantalla completa">
                <Link to="/beto" onClick={() => setOpen(false)}>
                  <Maximize2 className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </SheetHeader>
          <div className="min-h-0 flex-1">
            <BetoChat key={chatKey} compact conversationId={conversationId} onConversationChange={setConversationId} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
