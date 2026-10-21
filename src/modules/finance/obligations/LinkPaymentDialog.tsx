/**
 * Enlazar un pago que ya está en Administración (cargado a mano o desde el
 * estado de cuenta) a una cuota, sin registrar otra salida de dinero.
 * Portado de LinkMovementDialog (basicosystems@9cb08cd).
 */
import { useMemo, useState } from "react";
import { Link2, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/modules/pos/cart";
import {
  useInstanceLinks,
  useLinkCandidates,
  useLinkMovement,
  useUnlinkMovement,
  type FinanceAccount,
  type LinkCandidate,
  type Obligation,
  type ObligationInstance,
} from "../api";
import { formatDay } from "../lib";
import { matchesCandidate, shiftDay } from "./linkPayment";

const parse = (v: string) => {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};

export default function LinkPaymentDialog({ instance, obligation, accounts, onClose }: {
  instance: ObligationInstance;
  obligation: Obligation | undefined;
  accounts: FinanceAccount[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState(shiftDay(instance.due_date, -15));
  const [to, setTo] = useState(shiftDay(instance.due_date, 15));
  const [showLinked, setShowLinked] = useState(false);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [applied, setApplied] = useState<Record<string, string>>({});
  const candidates = useLinkCandidates(instance.id, from, to);
  const links = useInstanceLinks(instance.id);
  const link = useLinkMovement();
  const unlink = useUnlinkMovement();
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? "—";

  const rows = useMemo(
    () => (candidates.data ?? []).filter((m) => (showLinked || (m.amount - m.allocated > 0.005 && !m.linked_here)) && matchesCandidate(m, query)),
    [candidates.data, query, showLinked],
  );

  const doLink = (m: LinkCandidate) => {
    const amount = amounts[m.id] ? parse(amounts[m.id]) : null;
    const cover = m.currency === instance.currency ? null : parse(applied[m.id] ?? "");
    if (m.currency !== instance.currency && cover === null) return toast.error(`Indica cuánto cubre de la cuota en ${instance.currency}`);
    link.mutate(
      { instanceId: instance.id, movementId: m.id, amount, applied: cover },
      {
        onSuccess: () => toast.success("Pago enlazado a la cuota"),
        onError: (err) => toast.error("No se pudo enlazar", { description: err.message }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" /> Enlazar pago
          </DialogTitle>
          <DialogDescription>
            {obligation?.name ?? "Cuota"} · vence {formatDay(instance.due_date)}
            {instance.amount !== null ? ` · ${formatMoney(instance.amount, instance.currency)}` : ""}
          </DialogDescription>
        </DialogHeader>

        {(links.data ?? []).length > 0 && (
          <div className="space-y-1 rounded-lg border p-2 text-xs">
            <p className="font-semibold">Enlazados</p>
            {(links.data ?? []).map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  {l.movement ? `${formatDay(l.movement.occurred_on)} · ${accountName(l.movement.account_id)} · ` : ""}
                  {formatMoney(l.amount_allocated, l.movement?.currency ?? instance.currency)}
                  {l.movement && l.movement.currency !== instance.currency ? ` → ${formatMoney(l.amount_applied, instance.currency)}` : ""}
                  {l.movement?.reference ? ` · Ref ${l.movement.reference}` : ""}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Quitar enlace"
                  disabled={unlink.isPending}
                  onClick={() => unlink.mutate(l.id, { onError: (err) => toast.error("No se pudo quitar", { description: err.message }) })}
                >
                  <Unlink className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <Input placeholder="Buscar referencia, monto, concepto, cuenta, moneda…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Input type="date" aria-label="Desde" className="h-9 w-[150px]" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span>a</span>
            <Input type="date" aria-label="Hasta" className="h-9 w-[150px]" value={to} onChange={(e) => setTo(e.target.value)} />
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setFrom(shiftDay(from, -30));
                setTo(shiftDay(to, 30));
              }}
            >
              Ampliar ±30 días
            </Button>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={showLinked} onChange={(e) => setShowLinked(e.target.checked)} />
              Ver ya enlazados
            </label>
          </div>
        </div>

        <ul className="divide-y rounded-lg border">
          {candidates.isLoading && <li className="p-3 text-sm text-muted-foreground">Buscando…</li>}
          {candidates.error && <li className="p-3 text-sm text-destructive">{candidates.error.message}</li>}
          {!candidates.isLoading && rows.length === 0 && <li className="p-3 text-sm text-muted-foreground">No hay egresos disponibles en ese rango.</li>}
          {rows.map((m) => {
            const free = Math.max(0, m.amount - m.allocated);
            const otherCurrency = m.currency !== instance.currency;
            return (
              <li key={m.id} className="flex flex-wrap items-start justify-between gap-2 p-2 text-xs">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{[m.category, m.counterparty].filter(Boolean).join(" · ") || "Egreso"}</p>
                  <p className="text-muted-foreground">
                    {formatDay(m.occurred_on)} · {m.account_name}
                    {m.reference ? ` · Ref ${m.reference}` : ""}
                  </p>
                  <p className="num">
                    {formatMoney(m.amount, m.currency)}
                    {m.allocated > 0 && <span className="text-muted-foreground"> · disponible {formatMoney(free, m.currency)}</span>}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Input
                    className="num h-8 w-28 text-xs"
                    inputMode="decimal"
                    aria-label={`Monto a usar de ${m.reference ?? m.id}`}
                    placeholder={free.toFixed(2)}
                    value={amounts[m.id] ?? ""}
                    onChange={(e) => setAmounts({ ...amounts, [m.id]: e.target.value })}
                  />
                  {otherCurrency && (
                    <Input
                      className="num h-8 w-28 text-xs"
                      inputMode="decimal"
                      aria-label={`Cubre en ${instance.currency}`}
                      placeholder={`Cubre en ${instance.currency}`}
                      value={applied[m.id] ?? ""}
                      onChange={(e) => setApplied({ ...applied, [m.id]: e.target.value })}
                    />
                  )}
                  <Button size="sm" disabled={link.isPending || free <= 0.005 || m.linked_here} onClick={() => doLink(m)}>
                    {m.linked_here ? "Enlazado" : free <= 0.005 ? "Agotado" : "Enlazar"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted-foreground">
          Deja el monto vacío para usar todo lo disponible del movimiento, o escribe una parte para repartirlo entre varias cuotas. No se registra otra salida de dinero.
        </p>
      </DialogContent>
    </Dialog>
  );
}
