import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTenant } from "@/core/tenant-context";
import { cn } from "@/lib/utils";
import { downloadXlsx } from "@/modules/inventory/import/files";
import { formatMoney } from "@/modules/pos/cart";
import { parseAmount } from "@/modules/pos/usePosMoney";
import { addDays, caracasToday } from "@/modules/reports/dates";
import { catalogNames, useAccounts, useCatalog, useCreateMovement, useMovements, useTransfer, useVoidMovement, type FinanceAccount, type FinanceMovement } from "./api";
import { MOVEMENT_KIND_LABEL, formatDay, signedAmount } from "./lib";
import SuggestInput from "./SuggestInput";
import CategoryPicker from "./CategoryPicker";

const ALL = "all";

type DirectionFilter = "all" | "in" | "out" | "transfer";
const DIRECTION_FILTER_LABEL: Record<DirectionFilter, string> = { all: "Todos", in: "Ingresos", out: "Egresos", transfer: "Transferencias" };

/** Ingresos y egresos excluyen las transferencias entre cuentas, como el resumen. */
function matchesDirection(m: FinanceMovement, filter: DirectionFilter): boolean {
  if (filter === "all") return true;
  if (filter === "transfer") return m.kind === "transfer";
  return m.kind !== "transfer" && m.direction === filter;
}

export default function MovementsTab() {
  const { active, can } = useTenant();
  const { data: accounts = [] } = useAccounts();
  const today = caracasToday();
  const [accountId, setAccountId] = useState(ALL);
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);
  const { data: movements = [], isLoading, error } = useMovements({ accountId: accountId === ALL ? null : accountId, from, to });
  const [dialog, setDialog] = useState<"in" | "out" | "transfer" | null>(null);
  const [voiding, setVoiding] = useState<FinanceMovement | null>(null);
  const [direction, setDirection] = useState<DirectionFilter>("all");
  const [category, setCategory] = useState(ALL);
  const [query, setQuery] = useState("");
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const usable = accounts.filter((a) => a.is_active);
  const categories = useMemo(() => [...new Set(movements.map((m) => m.category).filter((c): c is string => Boolean(c)))].sort(), [movements]);
  const needle = query.trim().toLowerCase();
  const shown = movements.filter(
    (m) =>
      matchesDirection(m, direction) &&
      (category === ALL || m.category === category) &&
      (!needle || [m.note, m.category, m.counterparty, m.reference].some((v) => v?.toLowerCase().includes(needle))),
  );
  const totals = new Map<string, { in: number; out: number }>();
  for (const m of shown) {
    if (m.voided_at) continue;
    const t = totals.get(m.currency) ?? { in: 0, out: 0 };
    totals.set(m.currency, { ...t, [m.direction]: t[m.direction] + m.amount });
  }

  const exportRows = () =>
    downloadXlsx(
      `movimientos_${from}_${to}.xlsx`,
      ["Fecha", "Cuenta", "Tipo", "Entrada", "Salida", "Moneda", "Categoría", "Contraparte", "Referencia", "Nota", "Anulado"],
      shown.map((m) => [
        m.occurred_on,
        byId.get(m.account_id)?.name ?? "",
        MOVEMENT_KIND_LABEL[m.kind],
        m.direction === "in" ? m.amount : null,
        m.direction === "out" ? m.amount : null,
        m.currency,
        m.category,
        m.counterparty,
        m.reference,
        m.note,
        m.voided_at ? `Sí: ${m.void_reason}` : null,
      ]),
      "Movimientos",
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-card p-3">
        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger className="h-9 w-52" aria-label="Cuenta">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas las cuentas</SelectItem>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name} · {a.currency}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input type="date" aria-label="Desde" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} className="h-9 w-40" />
        <Input type="date" aria-label="Hasta" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} className="h-9 w-40" />
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" disabled={usable.length === 0} onClick={() => setDialog("in")}>
            Entrada
          </Button>
          <Button size="sm" disabled={usable.length === 0} onClick={() => setDialog("out")}>
            Salida
          </Button>
          <Button size="sm" variant="outline" disabled={usable.length < 2} onClick={() => setDialog("transfer")}>
            Transferir
          </Button>
          <Button size="sm" variant="outline" disabled={shown.length === 0} onClick={exportRows}>
            Excel
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Tipo">
          {(Object.keys(DIRECTION_FILTER_LABEL) as DirectionFilter[]).map((d) => (
            <Button key={d} size="sm" variant={direction === d ? "default" : "outline"} onClick={() => setDirection(d)} aria-pressed={direction === d}>
              {DIRECTION_FILTER_LABEL[d]}
            </Button>
          ))}
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-9 w-48" aria-label="Categoría">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas las categorías</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="search"
          aria-label="Buscar"
          placeholder="Buscar descripción, contraparte o referencia"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-9 min-w-0 flex-1 basis-56"
        />
      </div>

      {totals.size > 0 && (
        <div className="flex flex-wrap gap-2">
          {[...totals.entries()].map(([currency, t]) => (
            <div key={currency} className="rounded-xl border bg-card px-3 py-2 text-xs">
              <span className="mono mr-2 text-muted-foreground">{currency}</span>
              <span className="num">
                +{formatMoney(t.in, currency)} · −{formatMoney(t.out, currency)}
              </span>
            </div>
          ))}
        </div>
      )}

      {usable.length === 0 && <p className="text-sm text-muted-foreground">Crea una cuenta en la pestaña Cuentas para registrar movimientos.</p>}
      {isLoading && <p className="mono-cap text-xs text-muted-foreground">Cargando…</p>}
      {error && <p className="text-sm text-destructive">No se pudo cargar: {error.message}</p>}
      {!isLoading && shown.length === 0 && usable.length > 0 && (
        <p className="text-sm text-muted-foreground">{movements.length === 0 ? "Sin movimientos en el periodo." : "Ningún movimiento coincide con los filtros."}</p>
      )}

      <ul className="space-y-2">
        {shown.map((m) => (
          <li key={m.id} className={cn("flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3", m.voided_at && "opacity-60")}>
            <div className="min-w-0">
              <div className="font-semibold">
                {m.note || m.category || MOVEMENT_KIND_LABEL[m.kind]}
                {m.voided_at && (
                  <Badge variant="secondary" className="ml-2">
                    Anulado
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {formatDay(m.occurred_on)} · {byId.get(m.account_id)?.name} · {MOVEMENT_KIND_LABEL[m.kind]}
                {m.counterparty ? ` · ${m.counterparty}` : ""}
                {m.reference ? ` · Ref. ${m.reference}` : ""}
              </p>
              {m.voided_at && <p className="text-xs text-muted-foreground">Motivo: {m.void_reason}</p>}
            </div>
            <div className="flex items-center gap-2">
              <span className={cn("num font-semibold", m.voided_at && "line-through")}>
                {m.direction === "in" ? "+" : "−"}
                {formatMoney(Math.abs(signedAmount(m)), m.currency)}
              </span>
              {can("finanzas.anular") && !m.voided_at && !["sale", "cash_close"].includes(m.kind) && (
                <Button size="sm" variant="ghost" onClick={() => setVoiding(m)}>
                  Anular
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {(dialog === "in" || dialog === "out") && <MovementDialog direction={dialog} accounts={usable} onClose={() => setDialog(null)} />}
      {dialog === "transfer" && <TransferDialog accounts={usable} onClose={() => setDialog(null)} />}
      {voiding && <VoidDialog movement={voiding} onClose={() => setVoiding(null)} />}
    </div>
  );
}

function AccountSelect({ id, accounts, value, onChange, label }: { id: string; accounts: FinanceAccount[]; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
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
    </div>
  );
}

function MovementDialog({ direction, accounts, onClose }: { direction: "in" | "out"; accounts: FinanceAccount[]; onClose: () => void }) {
  const create = useCreateMovement();
  const { data: catalog = [] } = useCatalog();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(caracasToday());
  const [category, setCategory] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const account = accounts.find((a) => a.id === accountId);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = parseAmount(amount);
    if (!accountId || !(value > 0)) return toast.error("Elige la cuenta y el monto");
    create.mutate(
      { accountId, direction, amount: value, occurredOn: date, category, counterparty, reference, note },
      {
        onSuccess: () => {
          toast.success(direction === "in" ? "Entrada registrada" : "Salida registrada");
          onClose();
        },
        onError: (err) => toast.error("No se pudo registrar", { description: err.message }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{direction === "in" ? "Nueva entrada" : "Nueva salida"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <AccountSelect id="mv-account" label="Cuenta" accounts={accounts} value={accountId} onChange={setAccountId} />
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="mv-amount">Monto {account ? `en ${account.currency}` : ""}</Label>
              <Input id="mv-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="num h-11" autoFocus />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mv-date">Fecha</Label>
              <Input id="mv-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="mv-category">Categoría</Label>
              <CategoryPicker id="mv-category" value={category} onChange={setCategory} direction={direction} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mv-counterparty">{direction === "in" ? "De quién" : "A quién"}</Label>
              <SuggestInput id="mv-counterparty" value={counterparty} onChange={setCounterparty} options={catalogNames(catalog, "counterparty")} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="mv-reference">Referencia</Label>
            <Input id="mv-reference" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mv-note">Descripción</Label>
            <Input id="mv-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <Button type="submit" className="h-11 w-full" disabled={create.isPending}>
            Registrar
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TransferDialog({ accounts, initialFromId, onClose }: { accounts: FinanceAccount[]; initialFromId?: string; onClose: () => void }) {
  const transfer = useTransfer();
  const [fromId, setFromId] = useState(initialFromId ?? accounts[0]?.id ?? "");
  const [toId, setToId] = useState(accounts.find((a) => a.id !== (initialFromId ?? accounts[0]?.id))?.id ?? "");
  const [amountOut, setAmountOut] = useState("");
  const [amountIn, setAmountIn] = useState("");
  const [date, setDate] = useState(caracasToday());
  const [note, setNote] = useState("");
  const fromA = accounts.find((a) => a.id === fromId);
  const toA = accounts.find((a) => a.id === toId);
  const exchange = Boolean(fromA && toA && fromA.currency !== toA.currency);
  const out = parseAmount(amountOut);
  const inn = parseAmount(amountIn);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!fromId || !toId || fromId === toId) return toast.error("Elige dos cuentas distintas");
    if (!(out > 0) || (exchange && !(inn > 0))) return toast.error("Indica los montos");
    transfer.mutate(
      { fromId, toId, amountOut: out, amountIn: exchange ? inn : null, occurredOn: date, note },
      {
        onSuccess: () => {
          toast.success(exchange ? "Cambio registrado" : "Transferencia registrada");
          onClose();
        },
        onError: (err) => toast.error("No se pudo registrar", { description: err.message }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Transferir entre cuentas</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <AccountSelect id="tr-from" label="Sale de" accounts={accounts} value={fromId} onChange={setFromId} />
          <AccountSelect id="tr-to" label="Entra a" accounts={accounts.filter((a) => a.id !== fromId)} value={toId} onChange={setToId} />
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="tr-out">Sale {fromA ? `(${fromA.currency})` : ""}</Label>
              <Input id="tr-out" inputMode="decimal" value={amountOut} onChange={(e) => setAmountOut(e.target.value)} className="num h-11" />
            </div>
            {exchange ? (
              <div className="space-y-1">
                <Label htmlFor="tr-in">Entra ({toA?.currency})</Label>
                <Input id="tr-in" inputMode="decimal" value={amountIn} onChange={(e) => setAmountIn(e.target.value)} className="num h-11" />
              </div>
            ) : (
              <div className="space-y-1">
                <Label htmlFor="tr-date">Fecha</Label>
                <Input id="tr-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11" />
              </div>
            )}
          </div>
          {exchange && (
            <>
              <p className="text-xs text-muted-foreground">
                Cambio de moneda{out > 0 && inn > 0 ? ` a ${(inn / out).toLocaleString("es-VE", { maximumFractionDigits: 4 })} ${toA?.currency} por ${fromA?.currency}` : ""}.
              </p>
              <div className="space-y-1">
                <Label htmlFor="tr-date2">Fecha</Label>
                <Input id="tr-date2" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11" />
              </div>
            </>
          )}
          <div className="space-y-1">
            <Label htmlFor="tr-note">Nota</Label>
            <Input id="tr-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <Button type="submit" className="h-11 w-full" disabled={transfer.isPending}>
            Registrar
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function VoidDialog({ movement, onClose }: { movement: FinanceMovement; onClose: () => void }) {
  const voidMovement = useVoidMovement();
  const [reason, setReason] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    voidMovement.mutate(
      { id: movement.id, reason },
      {
        onSuccess: () => {
          toast.success("Movimiento anulado");
          onClose();
        },
        onError: (err) => toast.error("No se pudo anular", { description: err.message }),
      },
    );
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Anular movimiento</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Queda en el libro marcado como anulado y deja de contar en el saldo.
            {movement.transfer_id ? " Se anulan los dos lados de la transferencia." : ""}
            {movement.kind === "obligation" ? " La cuota vuelve a quedar pendiente." : ""}
          </p>
          <div className="space-y-1">
            <Label htmlFor="void-reason">Motivo *</Label>
            <Input id="void-reason" required value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </div>
          <Button type="submit" variant="destructive" className="h-11 w-full" disabled={voidMovement.isPending}>
            Anular
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
