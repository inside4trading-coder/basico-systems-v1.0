import { cn } from "@/lib/utils";
import { formatMoney } from "@/modules/pos/cart";
import type { ObligationInstance } from "../api";
import { DUE_STATE_LABEL, dueState, formatDay, relativeDay, remaining, type DueState } from "../lib";
import { STATE_CHIP } from "./chips";

/** Lista de cuotas. Portado de AdminListView.tsx (basicosystems@f551478b). */
export default function InstanceList({ instances, today, obligationName, onOpen }: {
  instances: ObligationInstance[];
  today: string;
  obligationName: (id: string) => string;
  onOpen: (i: ObligationInstance) => void;
}) {
  if (instances.length === 0) return <p className="text-sm text-muted-foreground">No hay cuotas con estos filtros.</p>;
  return (
    <ul className="space-y-2">
      {instances.map((i) => {
        const state: DueState = dueState(i.due_date, i.status, today);
        const left = remaining(i);
        return (
          <li key={i.id}>
            <button
              type="button"
              onClick={() => onOpen(i)}
              className={cn("flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3 text-left hover:border-primary", state === "overdue" && "border-destructive")}
            >
              <div className="min-w-0">
                <div className="font-semibold">
                  {obligationName(i.obligation_id)}{" "}
                  <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-normal", STATE_CHIP[state])}>{DUE_STATE_LABEL[state]}</span>
                  {i.status === "partial" && <span className="ml-1 text-[10px] text-muted-foreground">parcial</span>}
                </div>
                <p className="text-xs text-muted-foreground">
                  Vence {formatDay(i.due_date)} · {relativeDay(i.due_date, today)}
                  {i.proof_paths.length ? ` · ${i.proof_paths.length} comprobante${i.proof_paths.length === 1 ? "" : "s"}` : ""}
                </p>
              </div>
              <span className="num text-right">
                {i.amount === null ? "Variable" : formatMoney(i.amount, i.currency)}
                {i.status === "partial" && left !== null && <span className="block text-xs text-muted-foreground">faltan {formatMoney(left, i.currency)}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
