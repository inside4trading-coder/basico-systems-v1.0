/**
 * Ficha de una cuenta: saldo, equivalente en la moneda base, entradas y
 * salidas de un rango y sus movimientos. Portado de AdminAccountDetail.tsx
 * (basicosystems@f551478b).
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/modules/pos/cart";
import { addDays, caracasToday } from "@/modules/reports/dates";
import { useAccounts, useMovements, type TreasuryAccount } from "./api";
import { ACCOUNT_KIND_LABEL, MOVEMENT_KIND_LABEL, formatDay } from "./lib";
import { TransferDialog } from "./MovementsTab";

type Direction = "all" | "in" | "out";
const DIRECTION_LABEL: Record<Direction, string> = { all: "Todo", in: "Entradas", out: "Salidas" };

export default function AccountSheet({ account, baseCurrency, onClose }: {
  account: TreasuryAccount | null;
  baseCurrency: string;
  onClose: () => void;
}) {
  const today = caracasToday();
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);
  const [direction, setDirection] = useState<Direction>("all");
  const [moving, setMoving] = useState(false);
  const { data: accounts = [] } = useAccounts();
  const { data: movements = [], isLoading } = useMovements({ accountId: account?.id ?? null, from, to }, Boolean(account));

  if (!account) return null;
  const live = movements.filter((m) => !m.voided_at);
  const shown = movements.filter((m) => direction === "all" || m.direction === direction);
  const totalIn = live.filter((m) => m.direction === "in").reduce((a, m) => a + m.amount, 0);
  const totalOut = live.filter((m) => m.direction === "out").reduce((a, m) => a + m.amount, 0);
  const usable = accounts.filter((a) => a.is_active);

  return (
    <>
      <Sheet open onOpenChange={(v) => !v && onClose()}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{account.name}</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-4 text-sm">
            <p className="text-xs text-muted-foreground">
              {ACCOUNT_KIND_LABEL[account.kind]} · {account.currency}
              {account.is_active ? "" : " · Inactiva"}
            </p>
            <div className="rounded-xl border bg-card p-3">
              <p className="mono-cap text-[10px] text-muted-foreground">Saldo</p>
              <p className={cn("num text-2xl font-bold", account.balance < 0 && "text-destructive")}>{formatMoney(account.balance, account.currency)}</p>
              {account.currency !== baseCurrency && (
                <p className="num text-xs text-muted-foreground">
                  {account.balance_base === null ? "Sin tasa para convertir" : `≈ ${formatMoney(account.balance_base, baseCurrency)} a la tasa vigente`}
                </p>
              )}
            </div>
            {account.is_active && usable.length > 1 && (
              <Button className="h-11 w-full" variant="outline" onClick={() => setMoving(true)}>
                Mover dinero a otra cuenta
              </Button>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Input type="date" aria-label="Desde" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
              <Input type="date" aria-label="Hasta" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border p-2">
                <p className="mono-cap text-[10px] text-muted-foreground">Entró</p>
                <p className="num font-semibold">{formatMoney(totalIn, account.currency)}</p>
              </div>
              <div className="rounded-lg border p-2">
                <p className="mono-cap text-[10px] text-muted-foreground">Salió</p>
                <p className="num font-semibold">{formatMoney(totalOut, account.currency)}</p>
              </div>
            </div>
            <div className="flex gap-1" role="group" aria-label="Tipo de movimiento">
              {(Object.keys(DIRECTION_LABEL) as Direction[]).map((d) => (
                <Button key={d} size="sm" variant={direction === d ? "default" : "outline"} onClick={() => setDirection(d)} aria-pressed={direction === d}>
                  {DIRECTION_LABEL[d]}
                </Button>
              ))}
            </div>

            {isLoading && <p className="mono-cap text-xs text-muted-foreground">Cargando…</p>}
            {!isLoading && shown.length === 0 && <p className="text-xs text-muted-foreground">Sin movimientos en el rango.</p>}
            <ul className="space-y-1">
              {shown.map((m) => (
                <li key={m.id} className={cn("flex items-start justify-between gap-2 rounded-lg border p-2", m.voided_at && "opacity-60")}>
                  <div className="min-w-0 text-xs">
                    <p className={cn("truncate font-semibold", m.voided_at && "line-through")}>{m.note || m.category || MOVEMENT_KIND_LABEL[m.kind]}</p>
                    <p className="text-muted-foreground">
                      {formatDay(m.occurred_on)} · {MOVEMENT_KIND_LABEL[m.kind]}
                      {m.counterparty ? ` · ${m.counterparty}` : ""}
                      {m.reference ? ` · Ref. ${m.reference}` : ""}
                    </p>
                    {m.voided_at && <p className="text-muted-foreground">Anulado: {m.void_reason}</p>}
                  </div>
                  <span className={cn("num shrink-0 text-xs font-semibold", m.voided_at && "line-through")}>
                    {m.direction === "in" ? "+" : "−"}
                    {formatMoney(m.amount, m.currency)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </SheetContent>
      </Sheet>
      {moving && <TransferDialog accounts={usable} initialFromId={account.id} onClose={() => setMoving(false)} />}
    </>
  );
}
