/**
 * Formularios de cuentas por cobrar. Portado de RecoveryDrawer,
 * InvoiceDrawer y CompensationDrawer (AdminCashea.tsx, basicosystems@f551478b).
 */
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatMoney } from "@/modules/pos/cart";
import { parseAmount } from "@/modules/pos/usePosMoney";
import { caracasToday } from "@/modules/reports/dates";
import { useCurrentRate, useTenantSettings } from "@/modules/settings/api";
import type { FinanceAccount } from "../api";
import { formatDay } from "../lib";
import {
  useAddProviderEntry,
  useCollectReceivable,
  useCoverInstallment,
  useCreateReceivable,
  useRegisterCommission,
  useSettleProvider,
  type Receivable,
  type ReceivableInstallment,
} from "./api";
import { installmentLeft, splitInstallments } from "./lib";

function Shell({ title, onClose, busy, children }: { title: string; onClose: () => void; busy?: boolean; children: ReactNode }) {
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function AccountPicker({ id, accounts, value, onChange }: { id: string; accounts: FinanceAccount[]; value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="h-11">
        <SelectValue placeholder="Elige la cuenta" />
      </SelectTrigger>
      <SelectContent>
        {accounts.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.name} · {a.currency}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function useCurrencies(): string[] {
  const { data: settings } = useTenantSettings();
  return settings ? [settings.base_currency, ...(settings.local_currency ? [settings.local_currency] : [])] : ["USD"];
}

export function NewCreditDialog({ onClose }: { onClose: () => void }) {
  const create = useCreateReceivable();
  const currencies = useCurrencies();
  const today = caracasToday();
  const [customer, setCustomer] = useState("");
  const [doc, setDoc] = useState("");
  const [document, setDocument] = useState("");
  const [currency, setCurrency] = useState(currencies[0]);
  const [amount, setAmount] = useState("");
  const [count, setCount] = useState("1");
  const [firstDue, setFirstDue] = useState(() => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 30);
    return d.toISOString().slice(0, 10);
  });
  const [every, setEvery] = useState("30");
  const [note, setNote] = useState("");
  const total = parseAmount(amount);
  const parts = total > 0 ? splitInstallments(total, Number(count) || 1, firstDue, Number(every) || 30) : [];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!customer.trim()) return toast.error("Indica el cliente");
    if (!(total > 0)) return toast.error("Indica el monto");
    create.mutate(
      {
        p: {
          customer_name: customer,
          customer_doc: doc || null,
          document: document || null,
          issued_on: today,
          currency,
          amount: total,
          note: note || null,
          installments: parts,
        },
      },
      {
        onSuccess: () => {
          toast.success("Crédito registrado");
          onClose();
        },
        onError: (err) => toast.error("No se pudo registrar", { description: err.message }),
      },
    );
  };

  return (
    <Shell title="Nuevo crédito a cliente" onClose={onClose} busy={create.isPending}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <Field id="cr-customer" label="Cliente *">
              <Input id="cr-customer" value={customer} onChange={(e) => setCustomer(e.target.value)} autoFocus />
            </Field>
          </div>
          <Field id="cr-doc" label="Cédula o RIF">
            <Input id="cr-doc" value={doc} onChange={(e) => setDoc(e.target.value)} />
          </Field>
          <Field id="cr-document" label="Nota o factura">
            <Input id="cr-document" value={document} onChange={(e) => setDocument(e.target.value)} />
          </Field>
          <Field id="cr-amount" label="Monto *">
            <Input id="cr-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="num" />
          </Field>
          <Field id="cr-currency" label="Moneda">
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger id="cr-currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {currencies.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id="cr-count" label="Cuotas">
            <Input id="cr-count" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
          </Field>
          <Field id="cr-every" label="Cada (días)">
            <Input id="cr-every" inputMode="numeric" value={every} onChange={(e) => setEvery(e.target.value)} />
          </Field>
          <div className="col-span-2">
            <Field id="cr-first" label="Primera cuota vence">
              <Input id="cr-first" type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} />
            </Field>
          </div>
        </div>
        {parts.length > 1 && (
          <p className="text-xs text-muted-foreground">
            {parts.map((p) => `${formatDay(p.due_date)}: ${formatMoney(p.amount, currency)}`).join(" · ")}
          </p>
        )}
        <Field id="cr-note" label="Nota">
          <Input id="cr-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Button type="submit" className="h-11 w-full" disabled={create.isPending}>
          Registrar crédito
        </Button>
      </form>
    </Shell>
  );
}

export function CollectDialog({ receivable, accounts, onClose }: { receivable: Receivable; accounts: FinanceAccount[]; onClose: () => void }) {
  const collect = useCollectReceivable();
  const { data: rate } = useCurrentRate();
  const { data: settings } = useTenantSettings();
  const due = Math.round((receivable.amount - receivable.collected) * 100) / 100;
  const [accountId, setAccountId] = useState((accounts.find((a) => a.currency === receivable.currency) ?? accounts[0])?.id ?? "");
  const account = accounts.find((a) => a.id === accountId);
  const otherCurrency = Boolean(account && account.currency !== receivable.currency);
  const [payer, setPayer] = useState<"customer" | "provider">("customer");
  const [amount, setAmount] = useState<string | null>(null);
  const [applied, setApplied] = useState(due.toFixed(2));
  const [date, setDate] = useState(caracasToday());
  const [reference, setReference] = useState("");

  const suggested = (() => {
    if (!account || !otherCurrency) return parseAmount(applied);
    if (!rate?.rate || !settings) return null;
    const v = parseAmount(applied);
    return account.currency === settings.base_currency ? v / rate.rate : v * rate.rate;
  })();
  const amountText = amount ?? (suggested === null ? "" : suggested.toFixed(2));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = parseAmount(amountText);
    const appliedValue = otherCurrency ? parseAmount(applied) : value;
    if (!accountId || !(value > 0)) return toast.error("Elige la cuenta y el monto");
    if (!(appliedValue > 0)) return toast.error(`Indica cuánto cubre en ${receivable.currency}`);
    collect.mutate(
      {
        p_receivable_id: receivable.id,
        p_account_id: accountId,
        p_amount: value,
        p_occurred_on: date,
        p_payer: payer,
        p_applied: otherCurrency ? appliedValue : null,
        p_reference: reference || null,
        p_note: null,
      },
      {
        onSuccess: () => {
          toast.success("Cobro registrado");
          onClose();
        },
        onError: (err) => toast.error("No se pudo registrar", { description: err.message }),
      },
    );
  };

  return (
    <Shell title="Registrar cobro" onClose={onClose} busy={collect.isPending}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-muted-foreground">Falta {formatMoney(due, receivable.currency)}. El cobro se aplica desde la cuota más vieja.</p>
        {receivable.kind === "financing" && (
          <Field id="col-payer" label="Quién paga">
            <Select value={payer} onValueChange={(v) => setPayer(v as "customer" | "provider")}>
              <SelectTrigger id="col-payer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="customer">El cliente</SelectItem>
                <SelectItem value="provider">{receivable.provider}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        )}
        <Field id="col-account" label="Entra a">
          <AccountPicker
            id="col-account"
            accounts={accounts}
            value={accountId}
            onChange={(v) => {
              setAccountId(v);
              setAmount(null);
            }}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          {otherCurrency && (
            <Field id="col-applied" label={`Cubre (${receivable.currency})`}>
              <Input id="col-applied" inputMode="decimal" value={applied} onChange={(e) => setApplied(e.target.value)} className="num h-11" />
            </Field>
          )}
          <Field id="col-amount" label={`Entra (${account?.currency ?? ""})`}>
            <Input
              id="col-amount"
              inputMode="decimal"
              value={amountText}
              onChange={(e) => {
                setAmount(e.target.value);
                if (!otherCurrency) setApplied(e.target.value);
              }}
              className="num h-11"
            />
          </Field>
          <Field id="col-date" label="Fecha">
            <Input id="col-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11" />
          </Field>
        </div>
        <Field id="col-ref" label="Referencia">
          <Input id="col-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Button type="submit" className="h-11 w-full" disabled={collect.isPending || accounts.length === 0}>
          Registrar cobro
        </Button>
      </form>
    </Shell>
  );
}

export function CoverDialog({ receivable, installment, onClose }: { receivable: Receivable; installment: ReceivableInstallment; onClose: () => void }) {
  const cover = useCoverInstallment();
  const left = installmentLeft(installment);
  const [amount, setAmount] = useState(left.toFixed(2));
  const [date, setDate] = useState(caracasToday());
  const [document, setDocument] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    cover.mutate(
      { p_installment_id: installment.id, p_amount: parseAmount(amount), p_occurred_on: date, p_document: document || null },
      {
        onSuccess: () => {
          toast.success(`Cuota cubierta por ${receivable.provider}`);
          onClose();
        },
        onError: (err) => toast.error("No se pudo registrar", { description: err.message }),
      },
    );
  };
  return (
    <Shell title={`Cubierta por ${receivable.provider}`} onClose={onClose} busy={cover.isPending}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Cuota {installment.number} · vence {formatDay(installment.due_date)}. No entra dinero: queda a favor en la cuenta corriente con {receivable.provider}.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Field id="cov-amount" label={`Monto (${receivable.currency})`}>
            <Input id="cov-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="num h-11" />
          </Field>
          <Field id="cov-date" label="Fecha">
            <Input id="cov-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11" />
          </Field>
        </div>
        <Field id="cov-doc" label="Documento">
          <Input id="cov-doc" value={document} onChange={(e) => setDocument(e.target.value)} />
        </Field>
        <Button type="submit" className="h-11 w-full" disabled={cover.isPending}>
          Registrar cobertura
        </Button>
      </form>
    </Shell>
  );
}

export function CommissionDialog({ receivable, onClose }: { receivable: Receivable; onClose: () => void }) {
  const commission = useRegisterCommission();
  const estimate = receivable.commission_rate > 0 ? (receivable.amount * receivable.commission_rate) / 100 : 0;
  const [amount, setAmount] = useState(estimate ? estimate.toFixed(2) : "");
  const [date, setDate] = useState(caracasToday());
  const submit = (e: FormEvent) => {
    e.preventDefault();
    commission.mutate(
      { p_receivable_id: receivable.id, p_amount: parseAmount(amount), p_occurred_on: date, p_note: null },
      {
        onSuccess: () => {
          toast.success("Comisión registrada");
          onClose();
        },
        onError: (err) => toast.error("No se pudo registrar", { description: err.message }),
      },
    );
  };
  return (
    <Shell title={`Comisión de ${receivable.provider}`} onClose={onClose} busy={commission.isPending}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-muted-foreground">Lo que la financiadora descuenta al pagarte. Baja la deuda sin mover dinero.</p>
        <div className="grid grid-cols-2 gap-2">
          <Field id="com-amount" label={`Monto (${receivable.currency})`}>
            <Input id="com-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="num h-11" />
          </Field>
          <Field id="com-date" label="Fecha">
            <Input id="com-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11" />
          </Field>
        </div>
        <Button type="submit" className="h-11 w-full" disabled={commission.isPending}>
          Registrar comisión
        </Button>
      </form>
    </Shell>
  );
}

export function ProviderInvoiceDialog({ provider, currency, onClose }: { provider: string; currency: string; onClose: () => void }) {
  const add = useAddProviderEntry();
  const [kind, setKind] = useState<"service_invoice" | "adjustment">("service_invoice");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(caracasToday());
  const [document, setDocument] = useState("");
  const [note, setNote] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate(
      { p_provider: provider, p_kind: kind, p_amount: parseAmount(amount), p_entry_date: date, p_currency: currency, p_document: document || null, p_note: note || null },
      {
        onSuccess: () => {
          toast.success("Registrado en la cuenta corriente");
          onClose();
        },
        onError: (err) => toast.error("No se pudo registrar", { description: err.message }),
      },
    );
  };
  return (
    <Shell title={`Cuenta corriente con ${provider}`} onClose={onClose} busy={add.isPending}>
      <form onSubmit={submit} className="space-y-3">
        <Field id="pe-kind" label="Tipo">
          <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
            <SelectTrigger id="pe-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="service_invoice">Factura de servicios (le debes)</SelectItem>
              <SelectItem value="adjustment">Ajuste (+ a tu favor, − en contra)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field id="pe-amount" label={`Monto (${currency})`}>
            <Input id="pe-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="num h-11" />
          </Field>
          <Field id="pe-date" label="Fecha">
            <Input id="pe-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11" />
          </Field>
        </div>
        <Field id="pe-doc" label="Documento">
          <Input id="pe-doc" value={document} onChange={(e) => setDocument(e.target.value)} />
        </Field>
        <Field id="pe-note" label="Nota">
          <Input id="pe-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Button type="submit" className="h-11 w-full" disabled={add.isPending}>
          Registrar
        </Button>
      </form>
    </Shell>
  );
}

export function SettleDialog({ provider, balance, currency, accounts, onClose }: {
  provider: string;
  balance: number;
  currency: string;
  accounts: FinanceAccount[];
  onClose: () => void;
}) {
  const settle = useSettleProvider();
  const [direction, setDirection] = useState<"in" | "out">(balance >= 0 ? "in" : "out");
  const [accountId, setAccountId] = useState((accounts.find((a) => a.currency === currency) ?? accounts[0])?.id ?? "");
  const [amount, setAmount] = useState(Math.abs(balance).toFixed(2));
  const [date, setDate] = useState(caracasToday());
  const [reference, setReference] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    settle.mutate(
      { p_provider: provider, p_account_id: accountId, p_direction: direction, p_amount: parseAmount(amount), p_entry_date: date, p_reference: reference || null },
      {
        onSuccess: () => {
          toast.success("Liquidación registrada");
          onClose();
        },
        onError: (err) => toast.error("No se pudo registrar", { description: err.message }),
      },
    );
  };
  return (
    <Shell title={`Liquidar con ${provider}`} onClose={onClose} busy={settle.isPending}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Saldo {formatMoney(balance, currency)} {balance >= 0 ? `a tu favor` : `que le debes a ${provider}`}.
        </p>
        <Field id="st-dir" label="Movimiento">
          <Select value={direction} onValueChange={(v) => setDirection(v as "in" | "out")}>
            <SelectTrigger id="st-dir">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="in">{provider} te paga</SelectItem>
              <SelectItem value="out">Le pagas a {provider}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field id="st-account" label="Cuenta">
          <AccountPicker id="st-account" accounts={accounts} value={accountId} onChange={setAccountId} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field id="st-amount" label="Monto">
            <Input id="st-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="num h-11" />
          </Field>
          <Field id="st-date" label="Fecha">
            <Input id="st-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11" />
          </Field>
        </div>
        <Field id="st-ref" label="Referencia">
          <Input id="st-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Button type="submit" className="h-11 w-full" disabled={settle.isPending || accounts.length === 0}>
          Registrar liquidación
        </Button>
      </form>
    </Shell>
  );
}
