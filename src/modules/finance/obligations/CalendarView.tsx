/**
 * Calendario mensual de vencimientos. Portado de AdminCalendar.tsx
 * (basicosystems@f551478b): semana desde el lunes, hasta dos cuotas por día y
 * "+N más"; la importancia crítica se marca con un punto.
 */
import { cn } from "@/lib/utils";
import { formatMoney } from "@/modules/pos/cart";
import type { Obligation, ObligationInstance } from "../api";
import { DUE_STATE_LABEL, dueState, monthGrid, type DueState } from "../lib";
import { STATE_CHIP } from "./chips";

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];


export default function CalendarView({ month, today, instances, obligations, onOpen, onDay }: {
  month: string;
  today: string;
  instances: ObligationInstance[];
  obligations: Map<string, Obligation>;
  onOpen: (instance: ObligationInstance) => void;
  onDay: (day: string) => void;
}) {
  const byDay = new Map<string, ObligationInstance[]>();
  for (const i of instances) {
    if (!i.due_date.startsWith(month)) continue;
    byDay.set(i.due_date, [...(byDay.get(i.due_date) ?? []), i]);
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="grid grid-cols-7 border-b bg-muted/40">
        {WEEKDAYS.map((d) => (
          <div key={d} className="mono-cap py-2 text-center text-[10px] text-muted-foreground">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {monthGrid(month).map((day, idx) => {
          if (!day) return <div key={idx} className="min-h-[72px] border-b border-r bg-muted/20 md:min-h-[104px]" />;
          const items = byDay.get(day) ?? [];
          const visible = items.slice(0, 2);
          const extra = items.length - visible.length;
          const critical = items.some((i) => obligations.get(i.obligation_id)?.importance === "critical" && i.status !== "paid");
          return (
            <div key={day} className={cn("flex min-h-[72px] flex-col gap-1 border-b border-r p-1 md:min-h-[104px]", day === today && "bg-primary/5")}>
              <button
                type="button"
                onClick={() => onDay(day)}
                className={cn(
                  "flex items-center gap-1 self-start rounded px-1.5 py-0.5 text-xs font-bold hover:bg-accent",
                  day === today && "bg-primary text-primary-foreground hover:bg-primary/90",
                )}
                aria-label={`Ver el ${Number(day.slice(8))}${items.length ? `, ${items.length} cuotas` : ""}`}
              >
                {Number(day.slice(8))}
                {critical && <span className="h-1.5 w-1.5 rounded-full bg-destructive" aria-label="importancia crítica" />}
              </button>
              {visible.map((i) => {
                const o = obligations.get(i.obligation_id);
                const state = dueState(i.due_date, i.status, today);
                return (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => onOpen(i)}
                    title={`${o?.name ?? ""} · ${DUE_STATE_LABEL[state]}`}
                    className={cn("truncate rounded border px-1 py-0.5 text-left text-[10px] leading-tight", STATE_CHIP[state])}
                  >
                    <span className="block truncate font-semibold">{o?.name ?? "—"}</span>
                    <span className="num hidden opacity-80 md:block">{i.amount === null ? "Variable" : formatMoney(i.amount, i.currency)}</span>
                  </button>
                );
              })}
              {extra > 0 && (
                <button type="button" onClick={() => onDay(day)} className="px-1 text-left text-[10px] font-semibold text-muted-foreground hover:text-foreground">
                  +{extra} más
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2 border-t p-2 text-[10px]">
        {(["overdue", "today", "soon", "later", "paid", "skipped"] as DueState[]).map((s) => (
          <span key={s} className={cn("rounded border px-1.5 py-0.5", STATE_CHIP[s])}>
            {DUE_STATE_LABEL[s]}
          </span>
        ))}
        <span className="flex items-center gap-1 px-1.5 py-0.5">
          <span className="h-1.5 w-1.5 rounded-full bg-destructive" /> Crítica
        </span>
      </div>
    </div>
  );
}
