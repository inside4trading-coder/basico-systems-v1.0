/**
 * Formularios de obligaciones y cuotas. Portado de CreateObligationSheet.tsx,
 * MarkPaidDialog.tsx, EditInstanceSheet.tsx y NewInstanceSheet.tsx
 * (basicosystems@f551478b).
 */
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useTenant } from "@/core/tenant-context";
import { formatMoney } from "@/modules/pos/cart";
import { parseAmount } from "@/modules/pos/usePosMoney";
import { caracasToday } from "@/modules/reports/dates";
import { useCurrentRate, useTenantSettings } from "@/modules/settings/api";
import {
  catalogNames,
  useAddInstance,
  useCatalog,
  usePayInstance,
  useSaveObligation,
  useSkipInstance,
  useUpdateInstance,
  useVoidInstance,
  type FinanceAccount,
  type Obligation,
  type ObligationInstance,
} from "../api";
import { FREQUENCY_LABEL, IMPORTANCE_LABEL, formatDay, remaining, type Frequency, type Importance } from "../lib";
import SuggestInput from "../SuggestInput";
import CategoryPicker from "../CategoryPicker";
import { ACCEPTED_PROOFS, pickProofs } from "./proofs";

function useCurrencies(): string[] {
  const { active } = useTenant();
  const { data: settings } = useTenantSettings();
  return settings ? [settings.base_currency, ...(settings.local_currency ? [settings.local_currency] : [])] : [active?.tenant.base_currency ?? "USD"];
}

export function ObligationDialog({ obligation, accounts, onClose }: { obligation: Obligation | null; accounts: FinanceAccount[]; onClose: () => void }) {
  const currencies = useCurrencies();
  const save = useSaveObligation();
  const { data: catalog = [] } = useCatalog();
  const [name, setName] = useState(obligation?.name ?? "");
  const [category, setCategory] = useState(obligation?.category ?? "");
  const [counterparty, setCounterparty] = useState(obligation?.counterparty ?? "");
  const [amount, setAmount] = useState(obligation?.amount === null || obligation?.amount === undefined ? "" : String(obligation.amount));
  const [currency, setCurrency] = useState(obligation?.currency ?? currencies[0]);
  const [frequency, setFrequency] = useState<Frequency>(obligation?.frequency ?? "monthly");
  const [start, setStart] = useState(obligation?.start_date ?? caracasToday());
  const [end, setEnd] = useState(obligation?.end_date ?? "");
  const [accountId, setAccountId] = useState(obligation?.account_id ?? "none");
  const [importance, setImportance] = useState<Importance>(obligation?.importance ?? "medium");
  const [responsible, setResponsible] = useState(obligation?.responsible ?? "");
  const [paymentMethod, setPaymentMethod] = useState(obligation?.payment_method ?? "");
  const [fixed, setFixed] = useState(obligation?.is_fixed_expense ?? false);
  const [notes, setNotes] = useState(obligation?.notes ?? "");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error("Ponle un nombre");
    save.mutate(
      {
        id: obligation?.id,
        name: name.trim(),
        category: category.trim() || null,
        counterparty: counterparty.trim() || null,
        amount: amount.trim() ? parseAmount(amount) : null,
        currency,
        frequency,
        start_date: start,
        end_date: end || null,
        account_id: accountId === "none" ? null : accountId,
        importance,
        responsible: responsible.trim() || null,
        payment_method: paymentMethod.trim() || null,
        is_fixed_expense: fixed,
        notes: notes.trim() || null,
      },
      {
        onSuccess: () => {
          toast.success(obligation ? "Obligación actualizada" : "Obligación creada");
          onClose();
        },
        onError: (err) => toast.error("No se pudo guardar", { description: err.message }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{obligation ? "Editar obligación" : "Nueva obligación"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="ob-name">Nombre *</Label>
            <Input id="ob-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Alquiler del local" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="ob-category">Categoría</Label>
              <CategoryPicker id="ob-category" value={category} onChange={setCategory} direction="out" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ob-counterparty">A quién se paga</Label>
              <SuggestInput id="ob-counterparty" value={counterparty} onChange={setCounterparty} options={catalogNames(catalog, "counterparty")} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="ob-amount">Monto (vacío si varía)</Label>
              <Input id="ob-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="num" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ob-currency">Moneda</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="ob-currency">
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
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="ob-frequency">Frecuencia</Label>
              <Select value={frequency} onValueChange={(v) => setFrequency(v as Frequency)}>
                <SelectTrigger id="ob-frequency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(FREQUENCY_LABEL) as Frequency[]).map((f) => (
                    <SelectItem key={f} value={f}>
                      {FREQUENCY_LABEL[f]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ob-importance">Importancia</Label>
              <Select value={importance} onValueChange={(v) => setImportance(v as Importance)}>
                <SelectTrigger id="ob-importance">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(IMPORTANCE_LABEL) as Importance[]).map((i) => (
                    <SelectItem key={i} value={i}>
                      {IMPORTANCE_LABEL[i]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="ob-start">{frequency === "once" ? "Vence" : "Primer vencimiento"}</Label>
              <Input id="ob-start" type="date" required value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            {frequency !== "once" && (
              <div className="space-y-1">
                <Label htmlFor="ob-end">Hasta (opcional)</Label>
                <Input id="ob-end" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="ob-responsible">Responsable</Label>
              <Input id="ob-responsible" value={responsible} onChange={(e) => setResponsible(e.target.value)} placeholder="Quién la paga" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ob-method">Método habitual</Label>
              <Input id="ob-method" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} placeholder="Transferencia, Zelle…" />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ob-account">Se paga normalmente desde</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger id="ob-account">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin cuenta fija</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} · {a.currency}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center justify-between gap-2 text-sm">
            Cuenta como gasto fijo mensual
            <Switch checked={fixed} onCheckedChange={setFixed} />
          </label>
          <div className="space-y-1">
            <Label htmlFor="ob-notes">Notas</Label>
            <Input id="ob-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <Button type="submit" className="h-11 w-full" disabled={save.isPending}>
            Guardar
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PayDialog({ instance, obligation, accounts, onClose }: {
  instance: ObligationInstance;
  obligation: Obligation | undefined;
  accounts: FinanceAccount[];
  onClose: () => void;
}) {
  const pay = usePayInstance();
  const { data: rate } = useCurrentRate();
  const { data: settings } = useTenantSettings();
  const due = remaining(instance);
  const preferred = accounts.find((a) => a.id === obligation?.account_id) ?? accounts.find((a) => a.currency === instance.currency) ?? accounts[0];
  const [accountId, setAccountId] = useState(preferred?.id ?? "");
  const account = accounts.find((a) => a.id === accountId);
  const otherCurrency = Boolean(account && account.currency !== instance.currency);

  // Monto sugerido en la moneda de la cuenta (con la tasa vigente si es otra).
  const convert = (value: number) => {
    if (!account || account.currency === instance.currency) return value;
    if (!rate?.rate || !settings) return null;
    return account.currency === settings.base_currency ? value / rate.rate : value * rate.rate;
  };
  const suggestedAmount = due === null ? null : convert(due);
  const [amount, setAmount] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [date, setDate] = useState(caracasToday());
  const [paidBy, setPaidBy] = useState(obligation?.responsible ?? "");
  const [reference, setReference] = useState("");
  const [settle, setSettle] = useState(false);
  const [files, setFiles] = useState<File[]>([]);

  const amountText = amount ?? (suggestedAmount === null ? "" : suggestedAmount.toFixed(2));
  const appliedValue = otherCurrency ? parseAmount(applied ?? (due === null ? "" : due.toFixed(2))) : parseAmount(amountText);
  const short = due !== null && appliedValue > 0 && appliedValue < due - 0.005;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = parseAmount(amountText);
    if (!accountId || !(value > 0)) return toast.error("Elige la cuenta y el monto");
    if (otherCurrency && !(appliedValue > 0)) return toast.error(`Indica cuánto cubre en ${instance.currency}`);
    pay.mutate(
      {
        instanceId: instance.id,
        accountId,
        amount: value,
        paidOn: date,
        reference,
        note: paidBy.trim() ? `Pagado por ${paidBy.trim()}` : undefined,
        applied: otherCurrency ? appliedValue : null,
        settle: short && settle,
        files,
      },
      {
        onSuccess: () => {
          toast.success(short && !settle ? "Pago parcial registrado" : "Pago registrado");
          onClose();
        },
        onError: (err) => toast.error("No se pudo completar", { description: err.message }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(v) => !v && !pay.isPending && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pagar {obligation?.name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Vence {formatDay(instance.due_date)}
            {instance.amount !== null ? ` · ${formatMoney(instance.amount, instance.currency)}` : " · monto variable"}
            {instance.paid_amount > 0 && due !== null ? ` · faltan ${formatMoney(due, instance.currency)}` : ""}
          </p>
          <div className="space-y-1">
            <Label htmlFor="pay-account">Desde</Label>
            <Select
              value={accountId}
              onValueChange={(v) => {
                setAccountId(v);
                setAmount(null);
              }}
            >
              <SelectTrigger id="pay-account" className="h-11">
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
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="pay-amount">Sale {account ? `(${account.currency})` : ""}</Label>
              <Input id="pay-amount" inputMode="decimal" value={amountText} onChange={(e) => setAmount(e.target.value)} className="num h-11" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pay-date">Fecha de pago</Label>
              <Input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11" />
            </div>
          </div>
          {otherCurrency && (
            <div className="space-y-1">
              <Label htmlFor="pay-applied">Cubre de la cuota ({instance.currency}) *</Label>
              <Input
                id="pay-applied"
                inputMode="decimal"
                value={applied ?? (due === null ? "" : due.toFixed(2))}
                onChange={(e) => setApplied(e.target.value)}
                className="num h-11"
              />
              <p className="text-xs text-muted-foreground">La cuenta está en otra moneda: indica cuánto de la cuota salda este pago.</p>
            </div>
          )}
          {short && (
            <label className="flex items-start justify-between gap-3 rounded-lg border p-3 text-sm">
              <span>
                El pago no cubre todo ({formatMoney(appliedValue, instance.currency)} de {formatMoney(due ?? 0, instance.currency)}).
                <span className="block text-xs text-muted-foreground">Sin marcar queda como pago parcial.</span>
              </span>
              <span className="flex items-center gap-2 whitespace-nowrap">
                Dar por pagada
                <Switch checked={settle} onCheckedChange={setSettle} />
              </span>
            </label>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="pay-by">Pagado por</Label>
              <Input id="pay-by" value={paidBy} onChange={(e) => setPaidBy(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pay-ref">Referencia</Label>
              <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="pay-proofs">Comprobantes (imagen o PDF)</Label>
            <Input id="pay-proofs" type="file" multiple accept={ACCEPTED_PROOFS} onChange={(e) => setFiles(pickProofs(e.target.files))} />
            {files.length > 0 && <p className="text-xs text-muted-foreground">{files.map((f) => f.name).join(", ")}</p>}
          </div>
          <Button type="submit" className="h-11 w-full" disabled={pay.isPending}>
            {pay.isPending ? "Registrando…" : "Registrar pago"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditInstanceDialog({ instance, onClose }: { instance: ObligationInstance; onClose: () => void }) {
  const update = useUpdateInstance();
  const [amount, setAmount] = useState(instance.amount === null ? "" : String(instance.amount));
  const [date, setDate] = useState(instance.due_date);
  const [note, setNote] = useState(instance.note ?? "");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    update.mutate(
      { instanceId: instance.id, amount: amount.trim() ? parseAmount(amount) : null, dueDate: date, note },
      {
        onSuccess: () => {
          toast.success("Cuota actualizada");
          onClose();
        },
        onError: (err) => toast.error("No se pudo guardar", { description: err.message }),
      },
    );
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar cuota</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <p className="text-xs text-muted-foreground">Esta cuota queda fija: cambios futuros de la obligación no la modifican.</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="ed-amount">Monto ({instance.currency})</Label>
              <Input id="ed-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="num" placeholder="Variable" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ed-date">Vence</Label>
              <Input id="ed-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ed-note">Nota</Label>
            <Input id="ed-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <Button type="submit" className="h-11 w-full" disabled={update.isPending}>
            Guardar
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AddInstanceDialog({ obligation, onClose }: { obligation: Obligation; onClose: () => void }) {
  const add = useAddInstance();
  const [amount, setAmount] = useState(obligation.amount === null ? "" : String(obligation.amount));
  const [date, setDate] = useState(caracasToday());
  const [note, setNote] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate(
      { obligationId: obligation.id, dueDate: date, amount: amount.trim() ? parseAmount(amount) : null, note },
      {
        onSuccess: () => {
          toast.success("Cuota agregada");
          onClose();
        },
        onError: (err) => toast.error("No se pudo agregar", { description: err.message }),
      },
    );
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Agregar cuota a {obligation.name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="add-amount">Monto ({obligation.currency})</Label>
              <Input id="add-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="num" placeholder="Variable" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="add-date">Vence</Label>
              <Input id="add-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="add-note">Motivo</Label>
            <Input id="add-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Pago extra, ajuste…" />
          </div>
          <Button type="submit" className="h-11 w-full" disabled={add.isPending}>
            Agregar
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Omitir o anular una cuota: ambas piden motivo. */
export function ReasonDialog({ instance, mode, onClose }: { instance: ObligationInstance; mode: "skip" | "void"; onClose: () => void }) {
  const skip = useSkipInstance();
  const voidInstance = useVoidInstance();
  const [reason, setReason] = useState("");
  const busy = skip.isPending || voidInstance.isPending;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const done = {
      onSuccess: () => {
        toast.success(mode === "skip" ? "Cuota omitida" : "Cuota anulada");
        onClose();
      },
      onError: (err: Error) => toast.error("No se pudo completar", { description: err.message }),
    };
    if (mode === "skip") skip.mutate({ instanceId: instance.id, note: reason }, done);
    else voidInstance.mutate({ instanceId: instance.id, reason }, done);
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "skip" ? "Omitir" : "Anular"} cuota del {formatDay(instance.due_date)}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {mode === "skip"
              ? "No se paga este periodo (exonerada, se pagó junto con otra…). Queda registrada como omitida."
              : "La cuota no corresponde (cargada por error, duplicada). Queda en el historial como anulada."}
          </p>
          <div className="space-y-1">
            <Label htmlFor="reason">Motivo *</Label>
            <Input id="reason" required value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </div>
          <Button type="submit" variant={mode === "void" ? "destructive" : "default"} className="h-11 w-full" disabled={busy}>
            {mode === "skip" ? "Omitir" : "Anular"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
