/**
 * Avisos sobre la caja abierta: si es de un día anterior y si ya pasó la hora
 * de cerrarla. Nunca cierran la caja solos. Portado de PosStaleSessionAlert y
 * PosClosingReminder (basicosystems@f551478b).
 */
import { useEffect, useState } from "react";
import { AlertTriangle, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { closingReminderDue, elapsedSince, isStaleSession } from "./sessionRules";

export default function SessionAlerts({
  openedAt,
  reminderTime,
  canClose,
  onClose,
}: {
  openedAt: string;
  reminderTime: string | null | undefined;
  canClose: boolean;
  onClose: () => void;
}) {
  const [now, setNow] = useState(() => new Date());
  const [staleDismissed, setStaleDismissed] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const stale = isStaleSession(openedAt, now);
  const reminder = closingReminderDue(reminderTime, now);

  if (stale && !staleDismissed) {
    return (
      <div role="alert" className="space-y-2 rounded-xl border border-destructive/50 bg-destructive/5 p-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="text-sm">
            <p className="font-semibold text-destructive">Caja abierta de un día anterior</p>
            <p className="text-xs text-muted-foreground">
              Se abrió el {new Date(openedAt).toLocaleString("es-VE", { timeZone: "America/Caracas" })} · lleva {elapsedSince(openedAt, now)} abierta. Lo
              que vendas hoy quedará en ese cierre.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!canClose} onClick={onClose}>
            Cerrar esa caja
          </Button>
          <Button size="sm" variant="outline" onClick={() => setStaleDismissed(true)}>
            Seguir con ella
          </Button>
        </div>
      </div>
    );
  }

  if (reminder) {
    return (
      <div role="status" className="flex items-center gap-2 rounded-xl border border-destructive bg-destructive/10 px-3 py-2">
        <BellRing className="h-4 w-4 shrink-0 text-destructive" />
        <p className="min-w-0 flex-1 text-sm font-semibold text-destructive">
          Recuerda cerrar la caja <span className="font-normal text-muted-foreground">· desde las {reminderTime!.slice(0, 5)}</span>
        </p>
        <Button size="sm" variant="destructive" disabled={!canClose} onClick={onClose}>
          Cerrar caja
        </Button>
      </div>
    );
  }

  return null;
}
