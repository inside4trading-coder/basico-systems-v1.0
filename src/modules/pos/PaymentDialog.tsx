/**
 * Cobro mixto: varios métodos, cada uno en su moneda, con IGTF y vuelto.
 * Portado de PosPaymentSheet.tsx (basicosystems@f551478b); los métodos, sus
 * campos y bancos salen de la configuración del negocio.
 */
import { useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { PaymentMethod } from "@/modules/settings/api";
import {
  changeIn,
  formatMoney,
  fromBase,
  paymentSummary,
  round2,
  suggestedAmount,
  type MoneySettings,
  type PaymentDraft,
} from "./cart";
import { parseAmount } from "./usePosMoney";

export interface PaymentResult {
  payments: PaymentDraft[];
  change: { currency: string; amount: number } | null;
  customer: { name?: string; doc?: string } | null;
  note: string | null;
}

export default function PaymentDialog({
  open,
  onOpenChange,
  total,
  money,
  methods,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  total: number;
  money: MoneySettings;
  methods: PaymentMethod[];
  busy: boolean;
  onConfirm: (result: PaymentResult) => void;
}) {
  const [payments, setPayments] = useState<PaymentDraft[]>([]);
  const [methodId, setMethodId] = useState<string | null>(null);
  const [amount, setAmount] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [changeCurrency, setChangeCurrency] = useState(money.baseCurrency);
  const [customerName, setCustomerName] = useState("");
  const [customerDoc, setCustomerDoc] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setPayments([]);
    setMethodId(null);
    setAmount(null);
    setFields({});
    setError(null);
    setCustomerName("");
    setCustomerDoc("");
    setNote("");
    setChangeCurrency(money.baseCurrency);
  }, [open, money.baseCurrency]);

  const usable = useMemo(
    () => methods.filter((m) => m.is_active && (m.currency === money.baseCurrency || m.currency === money.localCurrency)),
    [methods, money.baseCurrency, money.localCurrency],
  );
  const summary = paymentSummary(payments, usable, total, money);
  const method = usable.find((m) => m.id === methodId) ?? null;
  const suggested = method ? suggestedAmount(summary.missing, method, money) : 0;
  const shown = amount ?? (suggested > 0 ? suggested.toFixed(2) : "");
  // El vuelto sale de la gaveta en cualquiera de las monedas del negocio (p. ej. pagan en $ y se devuelve en Bs.).
  const changeCurrencies = [money.baseCurrency, ...(money.localCurrency && money.rate ? [money.localCurrency] : [])];
  const change = summary.excess > 0 ? changeIn(summary.excess, changeCurrency, money) : null;

  const pick = (id: string) => {
    setMethodId(id);
    setAmount(null);
    setFields({});
    setError(null);
  };

  const addPayment = () => {
    if (!method) return;
    const value = round2(parseAmount(shown));
    if (!(value > 0)) return setError("Indica el monto del pago.");
    if (method.currency === money.localCurrency && !money.rate) return setError("No hay tasa vigente para cobrar en bolívares.");
    const missingField = method.fields.find((f) => f.required && !(fields[f.id] ?? "").trim());
    if (missingField) return setError(`Falta ${missingField.label.toLowerCase()}.`);
    const { reference, bank, ...extra } = fields;
    setPayments([
      ...payments,
      { key: crypto.randomUUID(), methodId: method.id, amount: value, reference: reference?.trim() || undefined, bank: bank?.trim() || undefined, extra },
    ]);
    if (method.kind === "cash") setChangeCurrency(method.currency);
    setMethodId(null);
    setAmount(null);
    setFields({});
    setError(null);
  };

  const blocker = summary.unconvertible
    ? "Un pago usa una moneda sin tasa."
    : payments.length === 0
      ? "Registra al menos un pago."
      : summary.missing > 0
        ? "Registra pagos hasta cubrir el total."
        : summary.excess > 0 && !summary.hasCash
          ? "Se cobró de más sin efectivo: corrige el monto."
          : summary.excess > 0 && change === null
            ? "Elige la moneda del vuelto."
            : null;

  const finish = () => {
    if (blocker) return;
    onConfirm({
      payments,
      change: summary.excess > 0 && change !== null ? { currency: changeCurrency, amount: change } : null,
      customer: customerName.trim() || customerDoc.trim() ? { name: customerName.trim(), doc: customerDoc.trim() } : null,
      note: note.trim() || null,
    });
  };

  const local = fromBase(total, money.localCurrency ?? "", money);

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cobrar</DialogTitle>
        </DialogHeader>

        <div className="rounded-xl border bg-card p-4">
          <p className="mono-cap text-[10px] text-muted-foreground">Total a cobrar</p>
          <p className="num text-3xl font-bold">{formatMoney(total, money.baseCurrency)}</p>
          {local !== null && money.localCurrency && (
            <p className="num text-sm text-muted-foreground">
              {formatMoney(local, money.localCurrency)} · tasa {money.rate?.toLocaleString("es-VE", { maximumFractionDigits: 4 })}
            </p>
          )}
        </div>

        {payments.length > 0 && (
          <ul className="space-y-2" aria-label="Pagos registrados">
            {payments.map((p) => {
              const m = usable.find((x) => x.id === p.methodId);
              return (
                <li key={p.key} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-semibold">{m?.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[p.bank, p.reference ? `Ref. ${p.reference}` : null, ...Object.values(p.extra ?? {})].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                  <span className="num font-semibold">{formatMoney(p.amount, m?.currency ?? money.baseCurrency)}</span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Quitar pago"
                    onClick={() => setPayments(payments.filter((x) => x.key !== p.key))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {summary.missing > 0 && (
          <div className="space-y-3 rounded-xl border p-4">
            <p className="mono-cap text-[10px] text-muted-foreground">{payments.length === 0 ? "Método de pago" : "Otro método"}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {usable.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => pick(m.id)}
                  className={cn(
                    "min-h-16 rounded-lg border p-2 text-left text-sm font-semibold transition-colors",
                    m.id === methodId ? "border-primary bg-accent" : "hover:border-primary/40",
                  )}
                >
                  {m.name}
                  {!m.name.includes(m.currency) && <span className="mono block text-[10px] font-normal text-muted-foreground">{m.currency}</span>}
                </button>
              ))}
            </div>
            {method && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="pay-amount">Monto en {method.currency}</Label>
                  <Input
                    id="pay-amount"
                    inputMode="decimal"
                    value={shown}
                    onChange={(e) => setAmount(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addPayment()}
                    className="num h-12 text-lg font-bold"
                    autoFocus
                  />
                </div>
                {method.fields.map((f) => (
                  <div key={f.id} className="space-y-1">
                    <Label htmlFor={`pay-${f.id}`}>
                      {f.label}
                      {f.required ? " *" : ""}
                    </Label>
                    {f.type === "bank" && method.banks.length > 0 ? (
                      <Select value={fields[f.id] ?? ""} onValueChange={(v) => setFields({ ...fields, [f.id]: v })}>
                        <SelectTrigger id={`pay-${f.id}`} className="h-12">
                          <SelectValue placeholder="Banco" />
                        </SelectTrigger>
                        <SelectContent>
                          {method.banks.map((b) => (
                            <SelectItem key={b} value={b}>
                              {b}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input id={`pay-${f.id}`} value={fields[f.id] ?? ""} onChange={(e) => setFields({ ...fields, [f.id]: e.target.value })} className="h-12" />
                    )}
                  </div>
                ))}
              </div>
            )}
            {error && <p className="text-xs font-semibold text-destructive">{error}</p>}
            <Button className="h-12 w-full" disabled={!method} onClick={addPayment}>
              Usar este método
            </Button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 rounded-xl border p-4 sm:grid-cols-4">
          <Amount label="Total" value={formatMoney(total, money.baseCurrency)} />
          <Amount label="Pagado" value={formatMoney(summary.applied, money.baseCurrency)} />
          <Amount label="Falta" value={formatMoney(summary.missing, money.baseCurrency)} tone={summary.missing > 0 ? "text-destructive" : undefined} />
          <Amount label="Vuelto" value={formatMoney(summary.excess, money.baseCurrency)} tone={summary.excess > 0 ? "text-primary" : undefined} />
          {summary.igtf > 0 && <p className="col-span-full text-xs text-muted-foreground">Incluye IGTF {formatMoney(summary.igtf, money.baseCurrency)}</p>}
        </div>

        {summary.excess > 0 && summary.hasCash && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/40 bg-accent p-4">
            <span className="text-sm font-semibold">Vuelto en</span>
            {changeCurrencies.map((c) => (
              <Button key={c} size="sm" variant={c === changeCurrency ? "default" : "outline"} onClick={() => setChangeCurrency(c)}>
                {c}
              </Button>
            ))}
            {change !== null && <span className="num ml-auto text-xl font-bold">{formatMoney(change, changeCurrency)}</span>}
          </div>
        )}

        <details className="rounded-xl border p-4 text-sm">
          <summary className="cursor-pointer font-semibold">Cliente y nota (opcional)</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="pay-customer">Nombre</Label>
              <Input id="pay-customer" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pay-doc">Cédula o RIF</Label>
              <Input id="pay-doc" value={customerDoc} onChange={(e) => setCustomerDoc(e.target.value)} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="pay-note">Nota</Label>
              <Input id="pay-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
        </details>

        <Button size="lg" className="h-14 w-full text-base" disabled={Boolean(blocker) || busy} onClick={finish}>
          {busy ? "Registrando venta…" : "Finalizar venta"}
        </Button>
        {blocker && <p className="text-center text-xs text-muted-foreground">{blocker}</p>}
      </DialogContent>
    </Dialog>
  );
}

function Amount({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className="mono-cap text-[10px] text-muted-foreground">{label}</p>
      <p className={cn("num font-bold", tone)}>{value}</p>
    </div>
  );
}
