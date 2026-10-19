import type { DueState } from "../lib";

/** Fondo y borde de una cuota según su estado (siempre acompañado de texto). */
export const STATE_CHIP: Record<DueState, string> = {
  paid: "border-[hsl(var(--status-success)/0.4)] bg-[hsl(var(--status-success)/0.12)]",
  overdue: "border-destructive/50 bg-destructive/10",
  today: "border-[hsl(var(--status-warning)/0.6)] bg-[hsl(var(--status-warning)/0.15)]",
  soon: "border-[hsl(var(--status-warning)/0.4)] bg-[hsl(var(--status-warning)/0.08)]",
  later: "border-primary/30 bg-accent",
  skipped: "border-border bg-muted text-muted-foreground",
  void: "border-border bg-muted text-muted-foreground line-through",
};
