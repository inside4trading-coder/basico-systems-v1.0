import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useTenant } from "@/core/tenant-context";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/modules/pos/cart";
import { parseAmount } from "@/modules/pos/usePosMoney";
import { caracasToday } from "@/modules/reports/dates";
import { useCurrentRate, useTenantSettings } from "@/modules/settings/api";
import {
  useAccounts,
  useInstances,
  useObligations,
  usePayInstance,
  useSaveObligation,
  useSkipInstance,
  type FinanceAccount,
  type Obligation,
  type ObligationInstance,
} from "./api";
import { DUE_STATE_LABEL, FREQUENCY_LABEL, dueState, formatDay, type DueState, type Frequency } from "./lib";

type View = "pending" | "done" | "list";

export default function ObligationsTab() {
  const today = caracasToday();
  const { data: obligations = [] } = useObligations();
  const { data: instances = [], isLoading } = useInstances(today);
  const { data: accounts = [] } = useAccounts();
  const [view, setView] = useState<View>("pending");
  const [editing, setEditing] = useState<Obligation | "new" | null>(null);
  const [paying, setPaying] = useState<ObligationInstance | null>(null);
  const [skipping, setSkipping] = useState<ObligationInstance | null>(null);
  const byId = new Map(obligations.map((o) => [o.id, o]));

  const pending = instances.filter((i) => i.status === "pending");
  const done = instances.filter((i) => i.status !== "pending").sort((a, b) => b.due_date.localeCompare(a.due_date));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1" role="group" aria-label="Vista">
          {(
            [
              ["pending", `Por pagar (${pending.length})`],
              ["done", "Resueltas"],
              ["list", `Obligaciones (${obligations.length})`],
            ] as [View, string][]
          ).map(([v, label]) => (
            <Button key={v} size="sm" variant={view === v ? "default" : "outline"} onClick={() => setView(v)}>
              {label}
            </Button>
          ))}
        </div>
        <Button size="sm" onClick={() => setEditing("new")}>
          Nueva obligación
        </Button>
      </div>

      {isLoading && <p className="mono-cap text-xs text-muted-foreground">Cargando…</p>}

      {view !== "list" && (
        <ul className="space-y-2">
          {(view === "pending" ? pending : done).map((i) => {
            const o = byId.get(i.obligation_id);
            const state = dueState(i.due_date, i.status, today);
            return (
              <li key={i.id} className={cn("flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3", state === "overdue" && "border-destructive")}>
                <div className="min-w-0">
                  <div className="font-semibold">
                    {o?.name ?? "Obligación"} <StateBadge state={state} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Vence {formatDay(i.due_date)}
                    {o?.counterparty ? ` · ${o.counterparty}` : ""}
                    {i.paid_on ? ` · pagada ${formatDay(i.paid_on)}` : ""}
                    {i.note ? ` · ${i.note}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="num font-semibold">{i.amount === null ? "Variable" : formatMoney(i.amount, i.currency)}</span>
                  {i.status === "pending" && (
                    <>
                      <Button size="sm" onClick={() => setPaying(i)} disabled={accounts.filter((a) => a.is_active).length === 0}>
                        Pagar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setSkipping(i)}>
                        Omitir
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
          {(view === "pending" ? pending : done).length === 0 && !isLoading && (
            <p className="text-sm text-muted-foreground">{view === "pending" ? "No hay cuotas por pagar en los próximos 120 días." : "Sin cuotas resueltas en los últimos 60 días."}</p>
          )}
        </ul>
      )}

      {view === "list" && (
        <ul className="space-y-2">
          {obligations.map((o) => (
            <li key={o.id} className={cn("flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3", !o.is_active && "opacity-60")}>
              <div className="min-w-0">
                <div className="font-semibold">
                  {o.name} {!o.is_active && <Badge variant="secondary">Inactiva</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {FREQUENCY_LABEL[o.frequency]} desde {formatDay(o.start_date)}
                  {o.end_date ? ` hasta ${formatDay(o.end_date)}` : ""}
                  {o.category ? ` · ${o.category}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="num">{o.amount === null ? "Variable" : formatMoney(o.amount, o.currency)}</span>
                <Button size="sm" variant="outline" onClick={() => setEditing(o)}>
                  Editar
                </Button>
              </div>
            </li>
          ))}
          {obligations.length === 0 && (
            <p className="text-sm text-muted-foreground">Carga alquiler, servicios, nómina, impuestos o cualquier pago que se repite para verlos vencer aquí.</p>
          )}
        </ul>
      )}

      {editing && <ObligationDialog obligation={editing === "new" ? null : editing} accounts={accounts} onClose={() => setEditing(null)} />}
      {paying && <PayDialog instance={paying} obligation={byId.get(paying.obligation_id)} accounts={accounts.filter((a) => a.is_active)} onClose={() => setPaying(null)} />}
      {skipping && <SkipDialog instance={skipping} onClose={() => setSkipping(null)} />}
    </div>
  );
}

function StateBadge({ state }: { state: DueState }) {
  if (state === "later") return null;
  return <Badge variant={state === "overdue" ? "destructive" : "secondary"}>{DUE_STATE_LABEL[state]}</Badge>;
}

function ObligationDialog({ obligation, accounts, onClose }: { obligation: Obligation | null; accounts: FinanceAccount[]; onClose: () => void }) {
  const { active } = useTenant();
  const { data: settings } = useTenantSettings();
  const save = useSaveObligation();
  const currencies = settings ? [settings.base_currency, ...(settings.local_currency ? [settings.local_currency] : [])] : [active?.tenant.base_currency ?? "USD"];
  const [name, setName] = useState(obligation?.name ?? "");
  const [category, setCategory] = useState(obligation?.category ?? "");
  const [counterparty, setCounterparty] = useState(obligation?.counterparty ?? "");
  const [amount, setAmount] = useState(obligation?.amount === null || obligation?.amount === undefined ? "" : String(obligation.amount));
  const [currency, setCurrency] = useState(obligation?.currency ?? currencies[0]);
  const [frequency, setFrequency] = useState<Frequency>(obligation?.frequency ?? "monthly");
  const [start, setStart] = useState(obligation?.start_date ?? caracasToday());
  const [end, setEnd] = useState(obligation?.end_date ?? "");
  const [accountId, setAccountId] = useState(obligation?.account_id ?? "none");
  const [isActive, setIsActive] = useState(obligation?.is_active ?? true);
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
        is_active: isActive,
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
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
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
              <Input id="ob-category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Alquiler, impuestos…" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ob-counterparty">A quién se paga</Label>
              <Input id="ob-counterparty" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
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
          <div className="space-y-1">
            <Label htmlFor="ob-notes">Notas</Label>
            <Input id="ob-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {obligation && (
            <label className="flex items-center justify-between gap-2 text-sm">
              Activa
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </label>
          )}
          <Button type="submit" className="h-11 w-full" disabled={save.isPending}>
            Guardar
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PayDialog({ instance, obligation, accounts, onClose }: {
  instance: ObligationInstance;
  obligation: Obligation | undefined;
  accounts: FinanceAccount[];
  onClose: () => void;
}) {
  const pay = usePayInstance();
  const { data: rate } = useCurrentRate();
  const { data: settings } = useTenantSettings();
  const preferred = accounts.find((a) => a.id === obligation?.account_id) ?? accounts.find((a) => a.currency === instance.currency) ?? accounts[0];
  const [accountId, setAccountId] = useState(preferred?.id ?? "");
  const account = accounts.find((a) => a.id === accountId);
  const suggested = (() => {
    if (instance.amount === null || !account) return "";
    if (account.currency === instance.currency) return String(instance.amount);
    // Otra moneda: se sugiere con la tasa vigente; el usuario pone lo que salió de verdad.
    if (rate?.rate && settings) return (account.currency === settings.base_currency ? instance.amount / rate.rate : instance.amount * rate.rate).toFixed(2);
    return "";
  })();
  const [amount, setAmount] = useState<string | null>(null);
  const [date, setDate] = useState(caracasToday());
  const [reference, setReference] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = parseAmount(amount ?? suggested);
    if (!accountId || !(value > 0)) return toast.error("Elige la cuenta y el monto");
    pay.mutate(
      { instanceId: instance.id, accountId, amount: value, paidOn: date, reference },
      {
        onSuccess: () => {
          toast.success("Pago registrado");
          onClose();
        },
        onError: (err) => toast.error("No se pudo registrar", { description: err.message }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Pagar {obligation?.name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Vence {formatDay(instance.due_date)}
            {instance.amount !== null ? ` · ${formatMoney(instance.amount, instance.currency)}` : ""}
          </p>
          <div className="space-y-1">
            <Label htmlFor="pay-account">Desde</Label>
            <Select value={accountId} onValueChange={(v) => { setAccountId(v); setAmount(null); }}>
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
              <Label htmlFor="pay-amount">Monto {account ? `en ${account.currency}` : ""}</Label>
              <Input id="pay-amount" inputMode="decimal" value={amount ?? suggested} onChange={(e) => setAmount(e.target.value)} className="num h-11" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pay-date">Fecha</Label>
              <Input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11" />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="pay-ref">Referencia</Label>
            <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <Button type="submit" className="h-11 w-full" disabled={pay.isPending}>
            Registrar pago
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SkipDialog({ instance, onClose }: { instance: ObligationInstance; onClose: () => void }) {
  const skip = useSkipInstance();
  const [note, setNote] = useState("");
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Omitir cuota del {formatDay(instance.due_date)}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            skip.mutate(
              { instanceId: instance.id, note },
              {
                onSuccess: () => {
                  toast.success("Cuota omitida");
                  onClose();
                },
                onError: (err) => toast.error("No se pudo omitir", { description: err.message }),
              },
            );
          }}
          className="space-y-3"
        >
          <div className="space-y-1">
            <Label htmlFor="skip-note">Por qué no se paga *</Label>
            <Input id="skip-note" required value={note} onChange={(e) => setNote(e.target.value)} placeholder="Exonerado este mes, se pagó junto con…" autoFocus />
          </div>
          <Button type="submit" className="h-11 w-full" disabled={skip.isPending}>
            Omitir
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
