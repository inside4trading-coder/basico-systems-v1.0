/**
 * Entradas/salidas de efectivo y cierre de caja con conteo por moneda.
 * Portado de PosCashDrawerDialog.tsx y PosSessionDialogs.tsx
 * (basicosystems@f551478b). Lo esperado lo calcula el servidor.
 */
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useCashMovement, useCloseSession, useSessionSummary, type SessionSummary } from "./api";
import { cashCurrencyLabel } from "@/core/money";
import { formatMoney } from "./cart";
import { parseAmount } from "./usePosMoney";

export function CashMovementDialog({
  sessionId,
  currencies,
  open,
  onOpenChange,
}: {
  sessionId: string;
  currencies: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const move = useCashMovement();
  const [kind, setKind] = useState<"cash_in" | "cash_out">("cash_out");
  const [currency, setCurrency] = useState(currencies[0] ?? "USD");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) {
      setAmount("");
      setNote("");
    }
  }, [open]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = parseAmount(amount);
    if (!(value > 0)) return toast.error("Indica el monto");
    move.mutate(
      { sessionId, kind, currency, amount: value, note: note.trim() },
      {
        onSuccess: () => {
          toast.success(kind === "cash_in" ? "Entrada registrada" : "Salida registrada");
          onOpenChange(false);
        },
        onError: (err) => toast.error("No se pudo registrar", { description: err.message }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Movimiento de efectivo</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant={kind === "cash_in" ? "default" : "outline"} onClick={() => setKind("cash_in")}>
              Entrada
            </Button>
            <Button type="button" variant={kind === "cash_out" ? "default" : "outline"} onClick={() => setKind("cash_out")}>
              Salida
            </Button>
          </div>
          <div className="flex gap-2">
            {currencies.map((c) => (
              <Button key={c} type="button" size="sm" variant={c === currency ? "default" : "outline"} onClick={() => setCurrency(c)}>
                {cashCurrencyLabel(c)}
              </Button>
            ))}
          </div>
          <div className="space-y-1">
            <Label htmlFor="mov-amount">Monto</Label>
            <Input id="mov-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="num h-12 text-lg" autoFocus />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mov-note">Motivo *</Label>
            <Input id="mov-note" required value={note} onChange={(e) => setNote(e.target.value)} placeholder="Pago a proveedor, cambio de billetes…" />
          </div>
          <Button type="submit" className="h-12 w-full" disabled={move.isPending}>
            Registrar
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CloseSessionDialog({
  sessionId,
  baseCurrency,
  pendingSales,
  open,
  onOpenChange,
  onClosed,
}: {
  sessionId: string;
  baseCurrency: string;
  /** Ventas de esta sesión cobradas sin conexión que aún no llegan al servidor. */
  pendingSales: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClosed: () => void;
}) {
  const summary = useSessionSummary(open ? sessionId : null);
  const close = useCloseSession();
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [result, setResult] = useState<SessionSummary | null>(null);

  useEffect(() => {
    if (open) {
      setCounted({});
      setNote("");
      setResult(null);
    }
  }, [open]);

  const data = result ?? summary.data;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!data) return;
    const missing = data.cash.find((c) => (counted[c.currency] ?? "").trim() === "");
    if (missing) return toast.error(`Cuenta el efectivo en ${missing.currency}`);
    close
      .mutateAsync({ sessionId, counted: data.cash.map((c) => ({ currency: c.currency, amount: parseAmount(counted[c.currency]) })), note: note.trim() || undefined })
      .then((res) => {
        setResult(res);
        toast.success("Caja cerrada");
      })
      .catch((err: Error) => toast.error("No se pudo cerrar", { description: err.message }));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && result) onClosed();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{result ? "Caja cerrada" : "Cerrar caja"}</DialogTitle>
        </DialogHeader>
        {pendingSales > 0 && !result ? (
          <p role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">
            Hay {pendingSales} {pendingSales === 1 ? "venta" : "ventas"} sin conexión de esta caja que aún no se registran. Sincroniza o resuelve
            las pendientes antes de cerrar: si no, el cierre no las contaría.
          </p>
        ) : !data ? (
          <p className="mono-cap text-xs text-muted-foreground">{summary.isError ? summary.error.message : "Cargando resumen…"}</p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3 rounded-xl border p-4 text-sm">
              <div>
                <p className="mono-cap text-[10px] text-muted-foreground">Ventas</p>
                <p className="num text-xl font-bold">{data.sales.count}</p>
              </div>
              <div>
                <p className="mono-cap text-[10px] text-muted-foreground">Total vendido</p>
                <p className="num text-xl font-bold">{formatMoney(Number(data.sales.total), baseCurrency)}</p>
              </div>
              {((data.voided?.count ?? 0) > 0 || (data.returns?.count ?? 0) > 0) && (
                <p className="col-span-2 text-xs text-muted-foreground">
                  {data.voided?.count ? `Anuladas: ${data.voided.count} (${formatMoney(Number(data.voided.total), baseCurrency)})` : ""}
                  {data.voided?.count && data.returns?.count ? " · " : ""}
                  {data.returns?.count ? `Devoluciones: ${data.returns.count} (${formatMoney(Number(data.returns.total), baseCurrency)})` : ""}
                </p>
              )}
              {data.by_method.length > 0 && (
                <ul className="col-span-2 space-y-1 text-xs">
                  {data.by_method.map((m) => (
                    <li key={`${m.method}-${m.currency}`} className="flex justify-between">
                      <span>{m.method}</span>
                      <span className="num">{formatMoney(Number(m.amount), m.currency)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {data.cash.map((c) => {
              const diff = result ? c.difference : counted[c.currency] ? parseAmount(counted[c.currency]) - Number(c.expected) : null;
              return (
                <div key={c.currency} className="space-y-2 rounded-xl border p-4">
                  <p className="font-semibold">Efectivo {c.currency}</p>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <span>
                      Fondo <span className="num block text-sm">{formatMoney(Number(c.opening), c.currency)}</span>
                    </span>
                    <span>
                      Esperado <span className="num block text-sm font-semibold">{formatMoney(Number(c.expected), c.currency)}</span>
                    </span>
                    <span>
                      Diferencia
                      <span className={cn("num block text-sm font-semibold", diff !== null && Math.abs(Number(diff)) >= 0.01 && "text-destructive")}>
                        {diff === null ? "—" : formatMoney(Number(diff), c.currency)}
                      </span>
                    </span>
                  </div>
                  {!result && (
                    <Input
                      inputMode="decimal"
                      aria-label={`Contado en ${c.currency}`}
                      placeholder="Contado"
                      value={counted[c.currency] ?? ""}
                      onChange={(e) => setCounted({ ...counted, [c.currency]: e.target.value })}
                      className="num h-11"
                    />
                  )}
                </div>
              );
            })}
            {result ? (
              <Button type="button" className="h-12 w-full" onClick={onClosed}>
                Listo
              </Button>
            ) : (
              <>
                <div className="space-y-1">
                  <Label htmlFor="close-note">Nota</Label>
                  <Input id="close-note" value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
                <Button type="submit" variant="destructive" className="h-12 w-full" disabled={close.isPending}>
                  Cerrar caja
                </Button>
              </>
            )}
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
