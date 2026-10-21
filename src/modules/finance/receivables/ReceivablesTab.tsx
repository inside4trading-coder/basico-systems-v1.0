/**
 * Por cobrar: créditos a clientes y ventas con financiadoras, carga del
 * reporte de la financiadora y su cuenta corriente. Portado de
 * SublimeAdminReceivables (AdminCashea.tsx, basicosystems@f551478b).
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTenant } from "@/core/tenant-context";
import { canSupervise } from "@/core/tenant-selection";
import { cn } from "@/lib/utils";
import { downloadXlsx } from "@/modules/inventory/import/files";
import { formatMoney } from "@/modules/pos/cart";
import { caracasToday } from "@/modules/reports/dates";
import { usePaymentMethods, useTenantSettings } from "@/modules/settings/api";
import { useAccounts } from "../api";
import { formatDay } from "../lib";
import { useFinancingEnabled, useProviderLedger, useReceivables, useReceivablesSummary, useVoidProviderEntry, type Receivable } from "./api";
import { NewCreditDialog, ProviderInvoiceDialog, SettleDialog } from "./dialogs";
import { installmentLeft, nextDue } from "./lib";
import ReceivableSheet from "./ReceivableSheet";

type Filter = "open" | "overdue" | "credit" | "financing" | "paid" | "cancelled" | "all";
const FILTER_LABEL: Record<Filter, string> = {
  open: "Abiertas",
  overdue: "Vencidas",
  credit: "Crédito",
  financing: "Financiadoras",
  paid: "Cobradas",
  cancelled: "Canceladas",
  all: "Todas",
};

const LEDGER_LABEL = { coverage: "Cobertura de cuota", service_invoice: "Factura de servicios", settlement: "Liquidación", adjustment: "Ajuste" } as const;

function isOverdue(r: Receivable, today: string) {
  return r.status === "open" && r.installments.some((i) => i.due_date < today && installmentLeft(i) > 0.005);
}

function matches(r: Receivable, f: Filter, today: string) {
  switch (f) {
    case "open":
      return r.status === "open";
    case "overdue":
      return isOverdue(r, today);
    case "credit":
      return r.status === "open" && r.kind === "credit";
    case "financing":
      return r.status === "open" && r.kind === "financing";
    case "paid":
      return r.status === "paid";
    case "cancelled":
      return r.status === "cancelled";
    case "all":
      return true;
  }
}


/**
 * scope "all": Por cobrar de Administración (crédito y financiadoras).
 * scope "financing": el módulo de la financiadora (solo sus ventas, su
 * cuenta corriente y sin crédito propio).
 */
export default function ReceivablesTab({ scope = "all" }: { scope?: "all" | "financing" }) {
  const only = scope === "financing";
  const { active } = useTenant();
  const supervisor = canSupervise(active?.role);
  const today = caracasToday();
  const { data: allReceivables = [], isLoading, error } = useReceivables();
  const receivables = useMemo(() => (only ? allReceivables.filter((r) => r.kind === "financing") : allReceivables), [allReceivables, only]);
  const { data: summary } = useReceivablesSummary();
  const { data: ledger = [] } = useProviderLedger();
  const { data: accounts = [] } = useAccounts();
  const { data: methods = [] } = usePaymentMethods();
  const { data: settings } = useTenantSettings();
  const voidEntry = useVoidProviderEntry();
  const usable = accounts.filter((a) => a.is_active);
  const financing = useFinancingEnabled();
  const base = settings?.base_currency ?? "USD";

  const providers = useMemo(() => {
    const names = new Set<string>();
    methods.filter((m) => m.kind === "bnpl").forEach((m) => names.add(m.name));
    receivables.forEach((r) => r.provider && names.add(r.provider));
    ledger.forEach((e) => names.add(e.provider));
    return [...names].sort();
  }, [methods, receivables, ledger]);

  const [filter, setFilter] = useState<Filter>("open");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [ledgerDialog, setLedgerDialog] = useState<{ provider: string; currency: string; kind: "entry" | "settle"; balance: number } | null>(null);

  const counts = useMemo(() => {
    const c = {} as Record<Filter, number>;
    (Object.keys(FILTER_LABEL) as Filter[]).forEach((f) => (c[f] = receivables.filter((r) => matches(r, f, today)).length));
    return c;
  }, [receivables, today]);
  const needle = query.trim().toLowerCase();
  const shown = receivables.filter(
    (r) =>
      matches(r, filter, today) &&
      (!needle || [r.customer_name, r.document, r.external_ref, r.provider].some((v) => v?.toLowerCase().includes(needle))),
  );
  const opened = receivables.find((r) => r.id === openId) ?? null;

  const balances = summary?.providers ?? [];
  const financingKpis = useMemo(() => {
    const open = receivables.filter((r) => r.status === "open");
    let overdue = 0;
    let overdueCount = 0;
    for (const r of open)
      for (const i of r.installments)
        if (i.due_date < today && installmentLeft(i) > 0.005) {
          overdue += installmentLeft(i);
          overdueCount++;
        }
    return {
      open: open.length,
      pending: open.reduce((a, r) => a + Math.max(0, r.amount - r.collected), 0),
      collected: receivables.reduce((a, r) => a + r.collected, 0),
      overdue,
      overdueCount,
      balance: balances.filter((b) => b.currency === base).reduce((a, b) => a + b.balance, 0),
    };
  }, [receivables, balances, today, base]);
  const providerCards = [...new Set([...balances.map((b) => b.provider), ...providers.filter((p) => receivables.some((r) => r.provider === p))])];

  const exportRows = () =>
    downloadXlsx(
      `por_cobrar_${today}.xlsx`,
      ["Tipo", "Financiadora", "Cliente", "Documento", "Orden", "Fecha", "Moneda", "Monto", "Cobrado", "Pendiente", "Próxima cuota", "Estado"],
      shown.map((r) => [
        r.kind === "credit" ? "Crédito" : "Financiadora",
        r.provider,
        r.customer_name,
        r.document,
        r.external_ref,
        r.issued_on,
        r.currency,
        r.amount,
        r.collected,
        Math.max(0, r.amount - r.collected),
        nextDue(r.installments)?.due_date ?? null,
        r.status === "open" ? (isOverdue(r, today) ? "Vencida" : "Abierta") : r.status === "paid" ? "Cobrada" : "Cancelada",
      ]),
      "Por cobrar",
    );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {only ? (
          <>
            <Kpi label="Por cobrar" value={formatMoney(financingKpis.pending, base)} hint={`${financingKpis.open} ${financingKpis.open === 1 ? "abierta" : "abiertas"}`} strong />
            <Kpi
              label="Vencido"
              value={formatMoney(financingKpis.overdue, base)}
              hint={`${financingKpis.overdueCount} ${financingKpis.overdueCount === 1 ? "cuota" : "cuotas"}`}
              negative={financingKpis.overdueCount > 0}
            />
            <Kpi label="Cobrado" value={formatMoney(financingKpis.collected, base)} />
            <Kpi
              label="Cuenta corriente"
              value={formatMoney(Math.abs(financingKpis.balance), base)}
              hint={financingKpis.balance >= 0 ? "A tu favor" : "Le debes"}
              negative={financingKpis.balance < 0}
            />
          </>
        ) : (
          <>
            <Kpi label="Por cobrar" value={formatMoney(summary?.total ?? 0, base)} hint={`${summary?.open ?? 0} ${summary?.open === 1 ? "abierta" : "abiertas"}`} strong />
            <Kpi
              label="Vencido"
              value={formatMoney(summary?.overdue_total ?? 0, base)}
              hint={`${summary?.overdue_count ?? 0} ${summary?.overdue_count === 1 ? "cuota" : "cuotas"}`}
              negative={(summary?.overdue_count ?? 0) > 0}
            />
            <Kpi label="Crédito a clientes" value={formatMoney(summary?.credit_total ?? 0, base)} />
            {financing && <Kpi label="Con financiadoras" value={formatMoney(summary?.financing_total ?? 0, base)} />}
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {!only && (
          <Button size="sm" onClick={() => setCreating(true)}>
            Nuevo crédito
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={shown.length === 0} onClick={exportRows}>
          Excel
        </Button>
      </div>

      {financing && !only && (
        <Link to="/cashea" className="block rounded-xl border border-dashed bg-card p-3 text-sm hover:border-primary">
          <span className="font-semibold">{providers[0] ?? "Financiadora"}</span>
          <span className="text-muted-foreground"> · importar órdenes y pagos, cuenta corriente e historial en su módulo →</span>
        </Link>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Estado">
          {(Object.keys(FILTER_LABEL) as Filter[]).filter((f) => (only ? f !== "credit" && f !== "financing" : financing || f !== "financing")).map((f) => (
            <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)} aria-pressed={filter === f}>
              {FILTER_LABEL[f]} ({counts[f]})
            </Button>
          ))}
        </div>
        <Input
          type="search"
          aria-label="Buscar por cobrar"
          placeholder="Cliente, venta u orden"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-9 min-w-0 flex-1 basis-48"
        />
      </div>

      {isLoading && <p className="mono-cap text-xs text-muted-foreground">Cargando…</p>}
      {error && <p className="text-sm text-destructive">No se pudo cargar: {error.message}</p>}
      {!isLoading && shown.length === 0 && <p className="text-sm text-muted-foreground">Nada en este filtro.</p>}
      <ul className="space-y-2">
        {shown.map((r) => {
          const next = nextDue(r.installments);
          const late = isOverdue(r, today);
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setOpenId(r.id)}
                className={cn("flex w-full items-center justify-between gap-2 rounded-xl border bg-card p-3 text-left hover:bg-accent", late && "border-destructive/50")}
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold">{r.customer_name ?? "Sin cliente"}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.kind === "credit" ? "Crédito" : r.provider}
                    {r.document ? ` · ${r.document}` : ""}
                    {r.external_ref ? ` · orden ${r.external_ref}` : ""} · {formatDay(r.issued_on)}
                  </p>
                  {r.status === "open" && next && (
                    <p className={cn("text-xs", late ? "font-semibold text-destructive" : "text-muted-foreground")}>
                      {late ? "Vencida desde" : "Próxima cuota"} {formatDay(next.due_date)}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="num font-semibold">{formatMoney(r.status === "open" ? r.amount - r.collected : r.amount, r.currency)}</span>
                  {r.status !== "open" && <Badge variant="secondary">{r.status === "paid" ? "Cobrada" : "Cancelada"}</Badge>}
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {financing && only && providerCards.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm">Cuenta corriente con financiadoras</h2>
          <p className="text-xs text-muted-foreground">
            Lo que cubren de clientes morosos queda a tu favor; sus facturas de servicios, en contra. Se liquida con una transferencia.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {providerCards.map((p) => {
              const rows = balances.filter((b) => b.provider === p);
              const main = rows[0] ?? { provider: p, currency: base, balance: 0 };
              const entries = ledger.filter((e) => e.provider === p).slice(0, 8);
              return (
                <div key={p} className="space-y-2 rounded-xl border bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{p}</p>
                      {(rows.length ? rows : [main]).map((b) => (
                        <p key={b.currency} className={cn("num text-lg font-bold", b.balance < 0 && "text-destructive")}>
                          {formatMoney(b.balance, b.currency)}
                        </p>
                      ))}
                      <p className="text-xs text-muted-foreground">{main.balance >= 0 ? "A tu favor" : "Le debes"}</p>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Button size="sm" variant="outline" onClick={() => setLedgerDialog({ provider: p, currency: main.currency, kind: "entry", balance: main.balance })}>
                        Factura o ajuste
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setLedgerDialog({ provider: p, currency: main.currency, kind: "settle", balance: main.balance })}>
                        Liquidar
                      </Button>
                    </div>
                  </div>
                  <ul className="divide-y text-xs">
                    {entries.map((e) => (
                      <li key={e.id} className={cn("flex items-center justify-between gap-2 py-1.5", e.voided_at && "opacity-60")}>
                        <span className={cn("min-w-0 truncate", e.voided_at && "line-through")}>
                          {formatDay(e.entry_date)} · {LEDGER_LABEL[e.kind]}
                          {e.document ? ` · ${e.document}` : ""}
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          <span className="num">{formatMoney(e.amount, e.currency)}</span>
                          {supervisor && !e.voided_at && e.kind !== "coverage" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-1.5 text-xs"
                              disabled={voidEntry.isPending}
                              onClick={() => {
                                const reason = window.prompt("Motivo para anular");
                                if (!reason?.trim()) return;
                                voidEntry.mutate(
                                  { p_entry_id: e.id, p_reason: reason },
                                  { onSuccess: () => toast.success("Anulado"), onError: (err) => toast.error("No se pudo anular", { description: err.message }) },
                                );
                              }}
                            >
                              Anular
                            </Button>
                          )}
                        </span>
                      </li>
                    ))}
                    {entries.length === 0 && <li className="py-1.5 text-muted-foreground">Sin movimientos.</li>}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {creating && <NewCreditDialog onClose={() => setCreating(false)} />}
      {ledgerDialog?.kind === "entry" && (
        <ProviderInvoiceDialog provider={ledgerDialog.provider} currency={ledgerDialog.currency} onClose={() => setLedgerDialog(null)} />
      )}
      {ledgerDialog?.kind === "settle" && (
        <SettleDialog
          provider={ledgerDialog.provider}
          balance={ledgerDialog.balance}
          currency={ledgerDialog.currency}
          accounts={usable.filter((a) => a.currency === ledgerDialog.currency)}
          onClose={() => setLedgerDialog(null)}
        />
      )}
      <ReceivableSheet key={opened?.id} receivable={opened} accounts={usable} onClose={() => setOpenId(null)} />
    </div>
  );
}

function Kpi({ label, value, hint, strong, negative }: { label: string; value: string; hint?: string; strong?: boolean; negative?: boolean }) {
  return (
    <div className={cn("min-w-0 rounded-xl border bg-card p-3", strong && "border-primary/40")}>
      <p className="mono-cap text-[10px] text-muted-foreground">{label}</p>
      <p className={cn("num text-lg font-bold leading-tight", negative && "text-destructive")}>{value}</p>
      {hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
