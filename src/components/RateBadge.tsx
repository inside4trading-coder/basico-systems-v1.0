import { formatRate, formatRateDate } from "@/core/money";
import { cn } from "@/lib/utils";
import { useCurrentRate } from "@/modules/settings/api";

/**
 * Tasa vigente siempre a la vista, con el día en que se actualizó: el cajero
 * cobra con ella y debe saber si está al día.
 */
export default function RateBadge({ className }: { className?: string }) {
  const { data: rate } = useCurrentRate();
  if (!rate) return null;
  const label = rate.source === "manual" ? "Tasa" : "Tasa BCV";
  return (
    <span
      className={cn(
        "num inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs",
        rate.stale ? "border-destructive text-destructive" : "text-muted-foreground",
        className,
      )}
      title={rate.stale ? "La tasa no está al día" : `Rige desde ${rate.effective_date}`}
    >
      {label} Bs. {formatRate(rate.rate)}
      <span className="opacity-80">· {formatRateDate(rate.effective_date)}{rate.stale ? " (vieja)" : ""}</span>
    </span>
  );
}
