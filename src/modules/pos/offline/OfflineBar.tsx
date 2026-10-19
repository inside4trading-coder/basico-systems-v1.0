/**
 * Estado de la conexión y de las ventas cobradas sin red. Las rechazadas por
 * el servidor se muestran con el motivo para reintentar o descartar.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatMoney } from "../cart";
import { formatSaleDate } from "../receipt";
import type { OfflinePos } from "./useOfflinePos";

export default function OfflineBar({ offline, sessionId }: { offline: OfflinePos; sessionId: string }) {
  const [open, setOpen] = useState(false);
  const { online, queue, syncing, snapshotAt } = offline;
  const failed = queue.filter((q) => q.status === "failed");
  const pending = queue.length - failed.length;
  const otherSessions = queue.filter((q) => q.sessionId !== sessionId).length;

  if (online && queue.length === 0) return null;

  return (
    <div
      role="status"
      className={cn(
        "space-y-2 rounded-xl border p-3 text-sm",
        failed.length > 0 ? "border-destructive" : online ? "border-primary/40 bg-accent" : "border-[hsl(var(--status-warning))] bg-[hsl(var(--status-warning)/0.08)]",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold">{online ? "Conectado" : "Sin conexión: modo contingencia"}</p>
          <p className="text-xs text-muted-foreground">
            {!online &&
              (snapshotAt ? `Catálogo guardado: ${formatSaleDate(snapshotAt)} · ` : "Este equipo no tiene catálogo guardado: solo se puede vender con conexión · ")}
            {pending > 0 && `${pending} ${pending === 1 ? "venta pendiente" : "ventas pendientes"} de registrar · `}
            {failed.length > 0 && `${failed.length} requiere${failed.length === 1 ? "" : "n"} atención · `}
            {otherSessions > 0 && `(${otherSessions} de otra caja)`}
          </p>
        </div>
        <div className="flex gap-2">
          {queue.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>
              {open ? "Ocultar" : "Ver"}
            </Button>
          )}
          {online && pending > 0 && (
            <Button size="sm" disabled={syncing} onClick={() => offline.sync()}>
              {syncing ? "Sincronizando…" : "Sincronizar"}
            </Button>
          )}
        </div>
      </div>

      {open && (
        <ul className="space-y-2">
          {queue.map((q) => (
            <li key={q.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-2">
              <div className="min-w-0">
                <p className="mono text-xs">
                  {q.receipt.number} · {formatSaleDate(q.soldAt)}
                </p>
                <p className="num font-semibold">{formatMoney(q.receipt.total, q.receipt.base_currency)}</p>
                {q.error && <p className="text-xs text-destructive">{q.error}</p>}
              </div>
              {q.status === "failed" && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={!online} onClick={() => offline.retry(q.key)}>
                    Reintentar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={async () => {
                      const ok = window.confirm(
                        `¿Descartar ${q.receipt.number}? La venta no quedará registrada aunque se haya cobrado. Hazlo solo si ya la registraste de otra forma o si se devolvió el dinero.`,
                      );
                      if (!ok) return;
                      await offline.discard(q.key);
                      toast.success(`${q.receipt.number} descartada`);
                    }}
                  >
                    Descartar
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
