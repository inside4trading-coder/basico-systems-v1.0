/**
 * Cobro mixto: varios métodos, cada uno en su moneda, con IGTF y vuelto.
 * Portado de PosPaymentSheet.tsx (basicosystems@f551478b); los métodos, sus
 * campos y bancos salen de la configuración del negocio.
 *
 * Orden de la pantalla: total y lo que falta, cliente y nota, pagos (uno por
 * método; cada uno nuevo propone lo que falta en su moneda) y vuelto. El origen
 * y la modalidad se eligen antes de vender; aquí solo se muestran, con «Cambiar».
 * Todo lo que se va registrando se guarda en el borrador del carrito: si se
 * cierra la pestaña o se va la luz, al volver el cobro sigue donde estaba.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Store, Trash2 } from "lucide-react";
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
  toBase,
  type MoneySettings,
  type PaymentDraft,
} from "./cart";
import { parseAmount } from "./usePosMoney";
import CustomerPicker from "@/modules/customers/CustomerPicker";
import { saleCustomer } from "@/modules/customers/lib";
import type { SaleCustomer } from "@/modules/customers/api";

export interface PaymentResult {
  payments: PaymentDraft[];
  change: { currency: string; amount: number } | null;
  customer: SaleCustomer | null;
  note: string | null;
}

/** Lo que se lleva registrado del cobro; vive en el borrador del carrito. */
export interface CheckoutDraft {
  payments: PaymentDraft[];
  customer: SaleCustomer;
  note: string;
  changeCurrency: string;
}

export default function PaymentDialog({
  open,
  onOpenChange,
  total,
  money,
  methods,
  saleSummary,
  onChangeSale,
  busy,
  initialNote = "",
  saved,
  onSave,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  total: number;
  money: MoneySettings;
  methods: PaymentMethod[];
  /** Origen y modalidad elegidos al empezar la venta (p. ej. «WhatsApp · Envío · MRW»). */
  saleSummary: string;
  /** Vuelve a elegir origen o modalidad sin perder el carrito. */
  onChangeSale: () => void;
  busy: boolean;
  /** Nota que ya se escribió desde el POS. */
  initialNote?: string;
  /** Cobro a medias guardado (se retoma al abrir). */
  saved?: CheckoutDraft | null;
  /** Guarda el cobro a medias en el borrador del carrito. */
  onSave?: (draft: CheckoutDraft) => void;
  onConfirm: (result: PaymentResult) => void;
}) {
  const [payments, setPayments] = useState<PaymentDraft[]>([]);
  const [methodId, setMethodId] = useState<string | null>(null);
  const [amount, setAmount] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [changeCurrency, setChangeCurrency] = useState(money.baseCurrency);
  const [customer, setCustomer] = useState<SaleCustomer>({});
  const [note, setNote] = useState("");
  const loaded = useRef(false);

  useEffect(() => {
    if (!open) {
      loaded.current = false;
      return;
    }
    setMethodId(null);
    setAmount(null);
    setFields({});
    setError(null);
    setPayments(saved?.payments ?? []);
    setCustomer(saved?.customer ?? {});
    setNote(saved?.note ?? initialNote);
    setChangeCurrency(saved?.changeCurrency ?? money.baseCurrency);
    loaded.current = true;
    // El borrador y la nota solo se toman al abrir el cobro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, money.baseCurrency]);

  // Cada cambio queda en el borrador del carrito.
  useEffect(() => {
    if (!open || !loaded.current || !onSave) return;
    onSave({ payments, customer, note, changeCurrency });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payments, customer, note, changeCurrency]);

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
  const missingLocal = money.localCurrency ? fromBase(summary.missing, money.localCurrency, money) : null;

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
      customer: saleCustomer(customer),
      note: note.trim() || null,
    });
  };

  const local = fromBase(total, money.localCurrency ?? "", money);
  const nextNumber = payments.length + 1;

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cobrar</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2 rounded-xl border bg-muted/40 px-4 py-2 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <Store className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-semibold" data-testid="sale-summary">
              {saleSummary}
            </span>
          </span>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onChangeSale}>
            Cambiar
          </Button>
        </div>

        {/* Total y lo que falta: siempre arriba. */}
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <div>
            <p className="mono-cap text-[10px] text-muted-foreground">Total a cobrar</p>
            {local !== null && money.localCurrency ? (
              <>
                <p className="num text-3xl font-bold">{formatMoney(local, money.localCurrency)}</p>
                <p className="num text-sm text-muted-foreground">
                  {formatMoney(total, money.baseCurrency)} · tasa {money.rate?.toLocaleString("es-VE", { maximumFractionDigits: 4 })}
                </p>
              </>
            ) : (
              <p className="num text-3xl font-bold">{formatMoney(total, money.baseCurrency)}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 border-t pt-3 sm:grid-cols-4">
            <Amount label="Total" value={formatMoney(total, money.baseCurrency)} />
            <Amount label="Pagado" value={formatMoney(summary.applied, money.baseCurrency)} />
            <Amount
              label="Falta"
              value={formatMoney(summary.missing, money.baseCurrency)}
              hint={summary.missing > 0 && missingLocal !== null && money.localCurrency ? formatMoney(missingLocal, money.localCurrency) : undefined}
              tone={summary.missing > 0 ? "text-destructive" : undefined}
            />
            <Amount label="Vuelto" value={formatMoney(summary.excess, money.baseCurrency)} tone={summary.excess > 0 ? "text-primary" : undefined} />
            {summary.igtf > 0 && <p className="col-span-full text-xs text-muted-foreground">Incluye IGTF {formatMoney(summary.igtf, money.baseCurrency)}</p>}
          </div>
        </div>

        {/* Cliente y nota: arriba y abiertos. */}
        <div className="space-y-3 rounded-xl border p-4 text-sm">
          <p className="font-semibold">Cliente y nota (opcional)</p>
          <CustomerPicker value={customer} onChange={setCustomer} />
          <div className="space-y-1">
            <Label htmlFor="pay-note">Nota</Label>
            <Input id="pay-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        {/* Pagos: uno por método; se pueden mezclar Bs. y REF. */}
        <div className="space-y-3 rounded-xl border p-4">
          <div className="flex items-baseline justify-between gap-2">
            <p className="mono-cap text-[10px] text-muted-foreground">Pagos</p>
            {payments.length > 0 && <p className="text-xs text-muted-foreground">Se pueden combinar varios métodos y monedas.</p>}
          </div>

          {payments.length > 0 && (
            <ol className="space-y-2" aria-label="Pagos registrados">
              {payments.map((p, i) => {
                const m = usable.find((x) => x.id === p.methodId);
                const base = m ? toBase(p.amount, m.currency, money) : null;
                return (
                  <li key={p.key} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                    <span className="mono w-5 text-xs text-muted-foreground">{i + 1}.</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{m?.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[p.bank, p.reference ? `Ref. ${p.reference}` : null, ...Object.values(p.extra ?? {})].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="num font-semibold">{formatMoney(p.amount, m?.currency ?? money.baseCurrency)}</p>
                      {m && m.currency !== money.baseCurrency && base !== null && (
                        <p className="num text-xs text-muted-foreground">{formatMoney(base, money.baseCurrency)}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Quitar pago ${i + 1}`}
                      onClick={() => setPayments(payments.filter((x) => x.key !== p.key))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                );
              })}
            </ol>
          )}

          {summary.missing > 0 ? (
            <div className="space-y-3 rounded-lg bg-muted/40 p-3">
              <p className="text-sm font-semibold">
                {payments.length === 0 ? "Elige el método de pago" : `Pago ${nextNumber}: elige otro método para lo que falta`}
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {usable.map((m) => {
                  const rest = suggestedAmount(summary.missing, m, money);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => pick(m.id)}
                      className={cn(
                        "min-h-16 rounded-lg border bg-card p-2 text-left text-sm font-semibold transition-colors",
                        m.id === methodId ? "border-primary bg-accent" : "hover:border-primary/40",
                      )}
                    >
                      {m.name}
                      <span className="num block text-[11px] font-normal text-muted-foreground">
                        {rest > 0 ? formatMoney(rest, m.currency) : m.currency}
                      </span>
                    </button>
                  );
                })}
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
                    <p className="text-xs text-muted-foreground">Cambia el monto si paga solo una parte; el resto va con otro método.</p>
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
                <Plus /> {payments.length === 0 ? "Agregar pago" : `Agregar pago ${nextNumber}`}
              </Button>
            </div>
          ) : (
            payments.length > 0 && <p className="text-sm font-semibold text-primary">Total cubierto.</p>
          )}
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

        <Button size="lg" className="h-14 w-full text-base" disabled={Boolean(blocker) || busy} onClick={finish}>
          {busy ? "Registrando venta…" : "Finalizar venta"}
        </Button>
        {blocker && <p className="text-center text-xs text-muted-foreground">{blocker}</p>}
      </DialogContent>
    </Dialog>
  );
}

function Amount({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div>
      <p className="mono-cap text-[10px] text-muted-foreground">{label}</p>
      <p className={cn("num font-bold", tone)}>{value}</p>
      {hint && <p className={cn("num text-xs", tone)}>{hint}</p>}
    </div>
  );
}
