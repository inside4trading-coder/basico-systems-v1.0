import { formatMoney } from "@/modules/pos/cart";
import { caracasToday } from "@/modules/reports/dates";
import { useFinanceSummary } from "./api";
import { ACCOUNT_KIND_LABEL, daysFrom, formatDay } from "./lib";

export default function SummaryTab() {
  const { data, isLoading, error } = useFinanceSummary();
  const today = caracasToday();
  if (isLoading) return <p className="mono-cap text-xs text-muted-foreground">Cargando…</p>;
  if (error) return <p className="text-sm text-destructive">No se pudo cargar: {error.message}</p>;
  if (!data) return null;

  // Total por moneda: no se suman dólares con bolívares.
  const totals = new Map<string, number>();
  for (const a of data.accounts.filter((x) => x.is_active)) totals.set(a.currency, (totals.get(a.currency) ?? 0) + a.balance);
  const overdueTotals = Object.entries(data.overdue.by_currency);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[...totals.entries()].map(([currency, total]) => (
          <div key={currency} className="rounded-xl border bg-card p-3">
            <p className="mono-cap text-[10px] text-muted-foreground">Disponible en {currency}</p>
            <p className="num text-xl font-bold">{formatMoney(total, currency)}</p>
          </div>
        ))}
        <div className={`rounded-xl border bg-card p-3 ${data.overdue.count ? "border-destructive" : ""}`}>
          <p className="mono-cap text-[10px] text-muted-foreground">Cuotas vencidas</p>
          <p className="num text-xl font-bold">{data.overdue.count}</p>
          {overdueTotals.length > 0 && (
            <p className="num text-xs text-muted-foreground">{overdueTotals.map(([c, v]) => formatMoney(Number(v), c)).join(" · ")}</p>
          )}
        </div>
      </div>

      {data.accounts.length === 0 && (
        <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
          Todavía no hay cuentas. Crea tus bancos, cajas y billeteras en la pestaña Cuentas para ver aquí los saldos.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-2 rounded-xl border bg-card p-4">
          <h2 className="text-sm">Saldos por cuenta</h2>
          <ul className="divide-y">
            {data.accounts.map((a) => (
              <li key={a.id} className={`flex items-center justify-between gap-2 py-2 ${a.is_active ? "" : "opacity-50"}`}>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{a.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {ACCOUNT_KIND_LABEL[a.kind]}
                    {a.last_movement_on ? ` · último movimiento ${formatDay(a.last_movement_on)}` : ""}
                  </p>
                </div>
                <span className={`num font-semibold ${a.balance < 0 ? "text-destructive" : ""}`}>{formatMoney(a.balance, a.currency)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-2 rounded-xl border bg-card p-4">
          <h2 className="text-sm">Vencen esta semana o ya vencieron</h2>
          {data.upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nada pendiente en los próximos 7 días.</p>
          ) : (
            <ul className="divide-y">
              {data.upcoming.map((u) => {
                const late = daysFrom(u.due_date, today);
                return (
                  <li key={u.id} className="flex items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{u.name}</p>
                      <p className={`text-xs ${late > 0 ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
                        {late > 0 ? `Vencida hace ${late} ${late === 1 ? "día" : "días"}` : late === 0 ? "Vence hoy" : `Vence ${formatDay(u.due_date)}`}
                      </p>
                    </div>
                    <span className="num">{u.amount === null ? "Monto variable" : formatMoney(u.amount, u.currency)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
