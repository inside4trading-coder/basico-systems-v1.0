/** Piezas de Beto: marca, avatar, caja de pregunta, sugerencias y mensajes. */
import { useRef, useState, type KeyboardEvent } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, BarChart3, ListChecks, Mic, MicOff, Package, ShoppingCart, Sparkles, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { BetoKpi, BetoMessage } from "./api";
import { allowedPrompt, promptLibrary, SUGGESTIONS, type PromptAccess } from "./prompts";
import { useSpeech } from "./useSpeech";

export const BETO_GRADIENT = "bg-gradient-to-br from-violet-600 via-fuchsia-500 to-pink-500";
export const MAX_QUESTION = 2000;

/** «[B]eto»: la B entre corchetes, como la marca. */
export function BetoWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-display font-bold", className)}>
      <span className="bg-gradient-to-r from-violet-500 to-fuchsia-500 bg-clip-text text-transparent">[B]</span>eto
    </span>
  );
}

export function BetoAvatar({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const box = size === "lg" ? "h-14 w-14" : size === "md" ? "h-8 w-8" : "h-6 w-6";
  const icon = size === "lg" ? "h-7 w-7" : size === "md" ? "h-4 w-4" : "h-3 w-3";
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full text-white shadow-sm", BETO_GRADIENT, box)} aria-hidden>
      <Sparkles className={icon} />
    </span>
  );
}

const SUGGESTION_ICON = { box: Package, cart: ShoppingCart, wallet: Wallet, chart: BarChart3 } as const;
const SUGGESTION_TONE = {
  box: "bg-violet-100 text-violet-700",
  cart: "bg-pink-100 text-pink-700",
  wallet: "bg-amber-100 text-amber-700",
  chart: "bg-sky-100 text-sky-700",
} as const;

export function Suggestions({ access, onPick, disabled }: { access: PromptAccess; onPick: (text: string) => void; disabled?: boolean }) {
  const items = SUGGESTIONS.filter((s) => allowedPrompt(s, access));
  if (items.length === 0) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {items.map((s) => {
        const Icon = SUGGESTION_ICON[s.icon];
        return (
          <button
            key={s.text}
            type="button"
            disabled={disabled}
            onClick={() => onPick(s.text)}
            className="flex items-center gap-3 rounded-lg border bg-card p-3 text-left text-sm transition-colors hover:border-violet-400 disabled:opacity-60"
          >
            <span className={cn("inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md", SUGGESTION_TONE[s.icon])}>
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <span>{s.text}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Caja de pregunta: texto, biblioteca de prompts, micrófono y enviar. Enter envía; Mayús+Enter, salto de línea. */
export function Composer({
  access,
  onSend,
  busy,
  autoFocus,
  placeholder = "Pregúntale a Beto sobre tu negocio…",
}: {
  access: PromptAccess;
  onSend: (text: string) => void;
  busy?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const speech = useSpeech((spoken) => setText(spoken.slice(0, MAX_QUESTION)));
  const library = promptLibrary(access);
  const ready = text.trim().length > 0 && !busy;

  const send = () => {
    if (!ready) return;
    speech.stop();
    onSend(text.trim());
    setText("");
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="rounded-surface border bg-card p-3 shadow-sm focus-within:border-violet-400">
      <textarea
        ref={input}
        value={text}
        autoFocus={autoFocus}
        maxLength={MAX_QUESTION}
        rows={2}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={speech.listening ? "Te escucho…" : placeholder}
        aria-label="Pregunta para Beto"
        className="block max-h-40 min-h-[3rem] w-full resize-none bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
      />
      <div className="mt-2 flex items-center gap-2 border-t pt-2">
        {library.length > 0 && (
          <Popover open={libraryOpen} onOpenChange={setLibraryOpen}>
            <PopoverTrigger asChild>
              <Button type="button" size="sm" variant="ghost" className="h-8 gap-1.5 rounded-full bg-violet-50 px-3 text-violet-700 hover:bg-violet-100">
                <ListChecks className="h-4 w-4" aria-hidden /> Prompts
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="max-h-80 w-80 overflow-y-auto p-2">
              {library.map((group) => (
                <div key={group.area} className="py-1">
                  <p className="mono-cap px-2 py-1 text-[10px] text-muted-foreground">{group.area}</p>
                  {group.prompts.map((p) => (
                    <button
                      key={p.text}
                      type="button"
                      className="block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                      onClick={() => {
                        setText(p.text);
                        setLibraryOpen(false);
                        input.current?.focus();
                      }}
                    >
                      {p.text}
                    </button>
                  ))}
                </div>
              ))}
            </PopoverContent>
          </Popover>
        )}
        <div className="ml-auto flex items-center gap-2">
          {speech.supported && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={cn("h-8 w-8 rounded-full", speech.listening && "bg-violet-100 text-violet-700")}
              aria-label={speech.listening ? "Dejar de dictar" : "Dictar con el micrófono"}
              aria-pressed={speech.listening}
              title={speech.listening ? "Dejar de dictar" : "Dictar con el micrófono"}
              onClick={speech.toggle}
            >
              {speech.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
          )}
          <Button
            type="button"
            size="icon"
            className={cn("h-8 w-8 rounded-full text-white", ready ? BETO_GRADIENT : "bg-muted text-muted-foreground")}
            aria-label="Enviar pregunta"
            disabled={!ready}
            onClick={send}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

const markdown: Components = {
  p: ({ children }) => <p className="my-1.5 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="my-1.5 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-1 pl-5">{children}</ol>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  h1: ({ children }) => <p className="mt-2 font-semibold">{children}</p>,
  h2: ({ children }) => <p className="mt-2 font-semibold">{children}</p>,
  h3: ({ children }) => <p className="mt-2 font-semibold">{children}</p>,
  a: ({ children }) => <span className="underline">{children}</span>,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-lg border">
      <table className="w-full text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b bg-muted/50 px-2 py-1.5 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="num border-b px-2 py-1.5 align-top last:border-b-0">{children}</td>,
  code: ({ children }) => <code className="rounded bg-muted px-1 font-mono text-xs">{children}</code>,
};

function KpiCards({ kpis }: { kpis: BetoKpi[] }) {
  return (
    <div className={cn("grid gap-2", kpis.length > 1 && "grid-cols-2", kpis.length > 2 && "lg:grid-cols-4")}>
      {kpis.map((k) => (
        <div key={k.label} className="rounded-lg border bg-card p-2.5">
          <p className="mono-cap text-[10px] text-muted-foreground">{k.label}</p>
          <p className="num text-base font-bold">{k.value}</p>
          {k.hint && <p className="text-[11px] text-muted-foreground">{k.hint}</p>}
        </div>
      ))}
    </div>
  );
}

export function Thinking() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
      <BetoAvatar size="sm" />
      <span className="motion-safe:animate-pulse">Beto está pensando…</span>
    </div>
  );
}

export function MessageView({ message }: { message: Pick<BetoMessage, "role" | "content" | "blocks" | "status"> }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <p className={cn("max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-muted px-3 py-2 text-sm", message.status === "fallido" && "opacity-60")}>
          {message.content}
        </p>
      </div>
    );
  }
  if (message.status === "pendiente") return <Thinking />;
  return (
    <div className="flex gap-2">
      <BetoAvatar size="sm" />
      <div className="min-w-0 flex-1 space-y-2 text-sm">
        {message.status === "fallido" ? (
          <p className="text-muted-foreground">No pude responder esta pregunta. Vuelve a intentarlo.</p>
        ) : (
          <>
            {message.blocks && message.blocks.length > 0 && <KpiCards kpis={message.blocks} />}
            {/* Sin HTML crudo: react-markdown no lo interpreta. */}
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdown}>
              {message.content}
            </ReactMarkdown>
          </>
        )}
      </div>
    </div>
  );
}
