import type { LucideIcon } from "lucide-react";
import { BadgePercent, History, Lock, PauseCircle, PlayCircle, PlusSquare, Printer, RotateCcw, StickyNote, Ticket, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

export type PosFunction = "manual" | "note" | "cash" | "discount" | "coupon" | "suspend" | "resume" | "return" | "history" | "reprint" | "close";

const FUNCTIONS: { id: PosFunction; icon: LucideIcon; label: string; online?: boolean }[] = [
  { id: "manual", icon: PlusSquare, label: "Agregar concepto" },
  { id: "note", icon: StickyNote, label: "Nota" },
  { id: "cash", icon: Wallet, label: "Caja", online: true },
  { id: "discount", icon: BadgePercent, label: "Descuento" },
  { id: "coupon", icon: Ticket, label: "Cupón", online: true },
  { id: "suspend", icon: PauseCircle, label: "Suspender", online: true },
  { id: "resume", icon: PlayCircle, label: "Recuperar", online: true },
  { id: "return", icon: RotateCcw, label: "Devolución", online: true },
  { id: "history", icon: History, label: "Historial", online: true },
  { id: "reprint", icon: Printer, label: "Reimprimir" },
  { id: "close", icon: Lock, label: "Cerrar caja", online: true },
];

/** Funciones del POS en una fila que se desliza en pantallas angostas. */
export default function FunctionsBar({
  online,
  hidden = [],
  badges = {},
  active = {},
  onAction,
}: {
  online: boolean;
  hidden?: PosFunction[];
  badges?: Partial<Record<PosFunction, number>>;
  active?: Partial<Record<PosFunction, boolean>>;
  onAction: (id: PosFunction) => void;
}) {
  return (
    <nav aria-label="Funciones del POS" className="-mx-1 overflow-x-auto px-1 pb-1">
      <ul className="flex gap-2">
        {FUNCTIONS.filter((f) => !hidden.includes(f.id)).map((f) => {
          const Icon = f.icon;
          const disabled = Boolean(f.online && !online);
          const badge = badges[f.id];
          return (
            <li key={f.id}>
              <button
                type="button"
                disabled={disabled}
                title={disabled ? "Necesita conexión" : undefined}
                onClick={() => onAction(f.id)}
                className={cn(
                  "relative flex h-16 w-[92px] shrink-0 flex-col items-center justify-center gap-1 rounded-xl border bg-card px-1 text-center transition-colors hover:border-primary disabled:opacity-40",
                  active[f.id] && "border-primary text-primary",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                <span className="text-[11px] font-semibold leading-tight">{f.label}</span>
                {badge ? (
                  <span className="num absolute right-1 top-1 rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">{badge}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
