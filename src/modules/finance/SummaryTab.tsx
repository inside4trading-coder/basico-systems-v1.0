/**
 * Resumen de tesorería: liquidez en la moneda base, ingresos y egresos del
 * periodo, por pagar, saldos por cuenta y lo que requiere atención. Portado
 * de SublimeAdminSummary (basicosystems@f551478b); los montos los calcula
 * treasury_summary en el servidor.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/modules/pos/cart";
import { caracasToday } from "@/modules/reports/dates";
import { useCurrentRate, usePaymentMethods } from "@/modules/settings/api";
import AccountSheet from "./AccountSheet";
import { useBankPending } from "./bank/api";
import { useTreasurySummary, type CategoryTotal, type TreasuryAccount } from "./api";
import { ACCOUNT_KIND_LABEL, MOVEMENT_KIND_LABEL, formatDay } from "./lib";
import { TREASURY_PERIOD_LABEL, attentionItems, shareOf, treasuryRange, type AttentionTarget, type TreasuryPeriod } from "./treasury";

export type FinanceTab = Exclude<AttentionTarget, "settings">;

const TONE_CLASS = {
  critical: "border-destructive/40 bg-destructive/5",
  warning: "border-amber-500/40 bg-amber-500/5",
  info: "",
} as const;

export default function SummaryTab({ onNavigate }: { onNavigate: (tab: FinanceTab) => void }) {
  const today = caracasToday();
  const [period, setPeriod] = useState<TreasuryPeriod>("month");
  const range = treasuryRange(period, today);
  const { data, isLoading, error } = useTreasurySummary(range.from, range.to);
  const { data: rate } = useCurrentRate();
  const { data: methods = [] } = usePaymentMethods();
  const { data: bank } = useBankPending();
  const [openId, setOpenId] = useState<string | null>(null);

  if (isLoading) return <p className="mono-cap text-xs text-muted-foreground">Cargando…</p>;
  if (error) return <p className="text-sm text-destructive">No se pudo cargar: {error.message}</p>;
  if (!data) return null;

  const base = data.base_currency;
  const result = data.period.income - data.period.expense;
  const accountsById = new Map(data.accounts.map((a) => [a.id, a]));
  const opened = data.accounts.find((a) => a.id === openId) ?? null;
  const attention = attentionItems({
    baseCurrency: base,
    overdueCount: data.payable.overdue_count,
    overdueTotal: data.payable.overdue_total,
    dueSoon: data.payable.due_soon,
    negativeAccounts: data.accounts.filter((a) => a.is_active && a.balance < 0).map((a) => a.name),
    unlinkedMethods: data.accounts.length > 0 ? methods.filter((m) => m.is_active && !m.account_id).length : 0,
    rate: !data.local_currency ? "ok" : !data.rate ? "missing" : rate?.stale ? "stale" : "ok",
    unconvertedMovements: data.period.unconverted,
    unconvertedCurrencies: data.liquidity.unconverted,
    bankUnmatched: bank?.unmatched ?? 0,
    bankPossible: bank?.possible ?? 0,
  });
  const periodHint = range.from === null ? "Desde el inicio" : range.from === range.to ? formatDay(range.to) : `${formatDay(range.from)} – ${formatDay(range.to)}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-lg border bg-card p-1" role="group" aria-label="Periodo">
          {(Object.keys(TREASURY_PERIOD_LABEL) as TreasuryPeriod[]).map((p) => (
            <Button key={p} size="sm" variant={period === p ? "default" : "ghost"} onClick={() => setPeriod(p)} aria-pressed={period === p}>
              {TREASURY_PERIOD_LABEL[p]}
            </Button>
          ))}
        </div>
        {data.rate && data.local_currency && (
          <p className="num text-xs text-muted-foreground">
            Tasa {data.rate.rate.toLocaleString("es-VE", { maximumFractionDigits: 4 })} {data.local_currency} por {base} · {formatDay(data.rate.effective_date)}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Liquidez" value={formatMoney(data.liquidity.total, base)} hint="Todas las cuentas" strong />
        <Kpi label="Disponible" value={formatMoney(data.liquidity.available, base)} hint="Cuentas activas" />
        <Kpi label="Ingresos" value={formatMoney(data.period.income, base)} hint={periodHint} />
        <Kpi label="Egresos" value={formatMoney(data.period.expense, base)} hint={periodHint} />
        <Kpi label="Resultado" value={formatMoney(result, base)} hint="Ingresos − egresos" strong negative={result < 0} />
        <Kpi
          label="Por pagar"
          value={formatMoney(data.payable.total, base)}
          hint={`Vencido y a 30 días · ${data.payable.count} ${data.payable.count === 1 ? "cuota" : "cuotas"}${data.payable.variable ? `, ${data.payable.variable} variable` : ""}`}
          onClick={() => onNavigate("obligations")}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Montos en {base}: saldos a la tasa vigente; ingresos y egresos a la tasa de cada día. Las transferencias entre cuentas no cuentan como ingreso ni egreso.
      </p>

      {data.accounts.length === 0 && (
        <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
          Todavía no hay cuentas. Crea tus bancos, cajas y billeteras en la pestaña Cuentas para ver aquí los saldos.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <section className="space-y-2">
          <h2 className="text-sm">Saldos por cuenta</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.accounts.filter((a) => a.is_active).map((a) => (
              <AccountCard key={a.id} account={a} base={base} onOpen={() => setOpenId(a.id)} />
            ))}
          </div>
          {data.accounts.some((a) => !a.is_active) && (
            <p className="text-xs text-muted-foreground">
              Inactivas: {data.accounts.filter((a) => !a.is_active).map((a) => `${a.name} ${formatMoney(a.balance, a.currency)}`).join(" · ")}
            </p>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-sm">Requiere tu atención</h2>
          {attention.length === 0 ? (
            <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Todo al día.</p>
          ) : (
            <ul className="space-y-2">
              {attention.map((item) => {
                const body = (
                  <>
                    <p className="font-semibold">{item.title}</p>
                    <p className="text-xs text-muted-foreground">{item.detail}</p>
                  </>
                );
                const cls = cn("block w-full rounded-xl border bg-card p-3 text-left text-sm hover:bg-accent", TONE_CLASS[item.tone]);
                return (
                  <li key={item.id}>
                    {item.target === "settings" ? (
                      <Link to="/configuracion" className={cls}>
                        {body}
                      </Link>
                    ) : (
                      <button type="button" className={cls} onClick={() => onNavigate(item.target as FinanceTab)}>
                        {body}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <CategoryList title="Ingresos por categoría" rows={data.period.income_by_category} total={data.period.income} base={base} />
        <CategoryList title="Egresos por categoría" rows={data.period.expense_by_category} total={data.period.expense} base={base} />
      </div>

      {data.period.by_currency.length > 1 && (
        <section className="space-y-1 rounded-xl border bg-card p-4">
          <h2 className="text-sm">En moneda original</h2>
          <ul className="divide-y text-sm">
            {data.period.by_currency.map((c) => (
              <li key={c.currency} className="flex flex-wrap justify-between gap-2 py-1.5">
                <span className="mono text-xs">{c.currency}</span>
                <span className="num text-xs">
                  Entró {formatMoney(c.income ?? 0, c.currency)} · Salió {formatMoney(c.expense ?? 0, c.currency)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2 rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm">Últimos movimientos</h2>
          <Button size="sm" variant="ghost" onClick={() => onNavigate("movements")}>
            Ver todos
          </Button>
        </div>
        {data.recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay movimientos.</p>
        ) : (
          <ul className="divide-y">
            {data.recent.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{m.note || m.category || MOVEMENT_KIND_LABEL[m.kind]}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDay(m.occurred_on)} · {accountsById.get(m.account_id)?.name} · {MOVEMENT_KIND_LABEL[m.kind]}
                  </p>
                </div>
                <span className="num shrink-0 text-sm">
                  {m.direction === "in" ? "+" : "−"}
                  {formatMoney(m.amount, m.currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AccountSheet account={opened} baseCurrency={base} onClose={() => setOpenId(null)} />
    </div>
  );
}

function Kpi({ label, value, hint, strong, negative, onClick }: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
  negative?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <p className="mono-cap text-[10px] text-muted-foreground">{label}</p>
      <p className={cn("num text-lg font-bold leading-tight", strong && "text-xl", negative && "text-destructive")}>{value}</p>
      {hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}
    </>
  );
  const cls = cn("min-w-0 rounded-xl border bg-card p-3 text-left", strong && "border-primary/40");
  return onClick ? (
    <button type="button" className={cn(cls, "hover:bg-accent")} onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className={cls}>{content}</div>
  );
}

function AccountCard({ account: a, base, onOpen }: { account: TreasuryAccount; base: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="min-w-0 rounded-xl border bg-card p-3 text-left hover:border-primary/40 hover:bg-accent">
      <div className="flex items-start justify-between gap-2">
        <p className="truncate font-semibold">{a.name}</p>
        <span className="mono shrink-0 text-[10px] text-muted-foreground">{a.currency}</span>
      </div>
      <p className={cn("num text-lg font-bold", a.balance < 0 && "text-destructive")}>{formatMoney(a.balance, a.currency)}</p>
      {a.currency !== base && (
        <p className="num text-xs text-muted-foreground">{a.balance_base === null ? "Sin tasa" : `≈ ${formatMoney(a.balance_base, base)}`}</p>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">
        {ACCOUNT_KIND_LABEL[a.kind]}
        {a.period_in || a.period_out ? ` · +${formatMoney(a.period_in, a.currency)} / −${formatMoney(a.period_out, a.currency)}` : ""}
        {a.last_movement_on ? ` · último ${formatDay(a.last_movement_on)}` : " · sin movimientos"}
      </p>
    </button>
  );
}

function CategoryList({ title, rows, total, base }: { title: string; rows: CategoryTotal[]; total: number; base: string }) {
  return (
    <section className="space-y-2 rounded-xl border bg-card p-4">
      <h2 className="text-sm">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin movimientos en el periodo.</p>
      ) : (
        <ul className="divide-y">
          {rows.map((r) => (
            <li key={r.category} className="flex items-center justify-between gap-2 py-1.5 text-sm">
              <span className="truncate">{r.category}</span>
              <span className="num shrink-0">
                {formatMoney(r.amount, base)} <span className="text-xs text-muted-foreground">{shareOf(r.amount, total)}%</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
