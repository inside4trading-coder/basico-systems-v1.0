/**
 * Inicio: saludo, accesos que cada usuario elige y ordena, actividad reciente
 * y, para dueño, administrador y encargado, el tablero del negocio: ventas de hoy y del mes, lo que requiere
 * atención, más vendidos, más rentables y lo que está creciendo. Portado de
 * SublimeDashboard (basicosystems@f551478b).
 */
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";
import { useEntitlements } from "@/core/useEntitlements";
import { cn } from "@/lib/utils";
import { useBankPending } from "@/modules/finance/bank/api";
import { useTreasurySummary } from "@/modules/finance/api";
import { useReceivablesSummary } from "@/modules/finance/receivables/api";
import { Greeting, MyShortcuts, RecentActivity } from "@/modules/home/HomeShortcuts";
import { growers, topProfit, topSellers } from "@/modules/home/lib";
import { useLocations } from "@/modules/inventory/api";
import { useOnboardingState } from "@/modules/onboarding/api";
import { doneCount } from "@/modules/onboarding/lib";
import { useRestock } from "@/modules/inventory/restockApi";
import { formatMoney, formatQty } from "@/modules/pos/cart";
import { elapsedSince, isStaleSession } from "@/modules/pos/sessionRules";
import { useSalesReport } from "@/modules/reports/api";
import { Kpi, Panel } from "@/modules/reports/components";
import { addDays, caracasToday, presetRange } from "@/modules/reports/dates";

export default function Home() {
  const { active, can } = useTenant();
  const entitlements = useEntitlements();
  const { data: locations, isLoading } = useLocations();
  const noLocations = !isLoading && (locations?.length ?? 0) === 0;
  const supervisor = can("reportes.ver");
  const setupPending = can("config.negocio") && active?.tenant.onboarding_completed_at === null;

  return (
    <AppShell wide={supervisor && entitlements.reportes}>
      <Greeting />
      {setupPending && <SetupCard tenantId={active?.tenant.id} />}
      {noLocations && can("config.negocio") && !setupPending ? (
        <div className="space-y-3 rounded-surface border bg-card p-4">
          <p className="text-sm">Para empezar, crea al menos una sede: la tienda o el almacén donde está tu mercancía.</p>
          <Button asChild>
            <Link to="/sedes">Crear sede</Link>
          </Button>
        </div>
      ) : (
        <>
          <MyShortcuts />
          <RecentActivity />
          {supervisor && entitlements.reportes && <Dashboard finance={entitlements.administracion} />}
        </>
      )}
    </AppShell>
  );
}

/** Mientras el dueño no termine los primeros pasos, el inicio lo lleva al asistente. */
function SetupCard({ tenantId }: { tenantId: string | undefined }) {
  const { data } = useOnboardingState(tenantId);
  const count = doneCount(data?.onboarding_steps);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-surface border border-primary/40 bg-primary/5 p-4">
      <div className="space-y-0.5">
        <p className="font-medium">Termina de configurar tu negocio</p>
        <p className="text-sm text-muted-foreground">{count} de 3 pasos listos: datos y sede, productos y equipo.</p>
      </div>
      <Button asChild>
        <Link to="/bienvenida">{count === 0 ? "Empezar" : "Continuar"}</Link>
      </Button>
    </div>
  );
}

interface OpenSession {
  id: string;
  number: string;
  opened_at: string;
  registers: { name: string } | null;
  locations: { name: string } | null;
}

function useOpenSessions() {
  const { active } = useTenant();
  return useQuery({
    queryKey: ["pos", active?.tenant.id, "open-sessions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_sessions")
        .select("id, number, opened_at, registers(name), locations(name)")
        .eq("status", "open")
        .order("opened_at");
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as OpenSession[];
    },
  });
}

interface Attention {
  id: string;
  tone: "critical" | "warning";
  title: string;
  detail: string;
  to: string;
}

function Dashboard({ finance }: { finance: boolean }) {
  const today = caracasToday();
  const base = useTenant().active?.tenant.base_currency ?? "USD";
  const day = useSalesReport(presetRange("today", today), null);
  const month = useSalesReport(presetRange("month", today), null);
  const last30 = useSalesReport({ from: addDays(today, -29), to: today }, null);
  const prev30 = useSalesReport({ from: addDays(today, -59), to: addDays(today, -30) }, null);
  const { data: sessions = [] } = useOpenSessions();
  const { data: restock = [] } = useRestock(null, 30, 15);
  const { data: treasury } = useTreasurySummary(presetRange("month", today).from, today, finance);
  const { data: bank } = useBankPending(finance);
  const { data: receivables } = useReceivablesSummary(finance);

  const money = (n: number) => formatMoney(n, base);
  const stale = sessions.filter((s) => isStaleSession(s.opened_at));
  const outOfStock = restock.filter((r) => r.available <= 0).length;

  const attention: Attention[] = [
    ...stale.map((s) => ({
      id: `session-${s.id}`,
      tone: "critical" as const,
      title: `Caja ${s.registers?.name ?? s.number} abierta desde un día anterior`,
      detail: `${s.locations?.name ?? ""} · lleva ${elapsedSince(s.opened_at)} abierta`,
      to: "/pos",
    })),
    ...(restock.length > 0
      ? [
          {
            id: "restock",
            tone: outOfStock > 0 ? ("critical" as const) : ("warning" as const),
            title: `${restock.length} producto${restock.length === 1 ? "" : "s"} por reponer`,
            detail: outOfStock > 0 ? `${outOfStock} ya sin existencia en alguna sede` : "Según mínimos y rotación de 30 días",
            to: "/control",
          },
        ]
      : []),
    ...(treasury && treasury.payable.overdue_count > 0
      ? [
          {
            id: "payable",
            tone: "critical" as const,
            title: `${treasury.payable.overdue_count} pago${treasury.payable.overdue_count === 1 ? "" : "s"} vencido${treasury.payable.overdue_count === 1 ? "" : "s"}`,
            detail: `Faltan ${money(treasury.payable.overdue_total)}`,
            to: "/administracion",
          },
        ]
      : []),
    ...(receivables && receivables.overdue_count > 0
      ? [
          {
            id: "receivable",
            tone: "warning" as const,
            title: `${receivables.overdue_count} cuota${receivables.overdue_count === 1 ? "" : "s"} por cobrar vencida${receivables.overdue_count === 1 ? "" : "s"}`,
            detail: `Por cobrar ${money(receivables.overdue_total)}`,
            to: "/administracion",
          },
        ]
      : []),
    ...(bank && bank.unmatched + bank.possible > 0
      ? [
          {
            id: "bank",
            tone: "warning" as const,
            title: `${bank.unmatched + bank.possible} movimiento${bank.unmatched + bank.possible === 1 ? "" : "s"} del banco por conciliar`,
            detail: bank.possible > 0 ? `${bank.possible} con posible coincidencia` : "Sin identificar",
            to: "/administracion",
          },
        ]
      : []),
  ];

  const sellers = topSellers(last30.data?.by_product ?? []);
  const profitable = topProfit(last30.data?.by_product ?? []);
  const growing = growers(last30.data?.by_product ?? [], prev30.data?.by_product ?? []);
  const d = day.data?.summary;
  const m = month.data?.summary;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* El día va en curso: contra el día completo de ayer el porcentaje engaña, se muestra el monto. */}
        <Kpi label="Ventas de hoy" value={d ? money(d.net) : "…"} hint={day.data ? `Ayer: ${money(day.data.previous.net)}` : undefined} />
        <Kpi label="Tickets de hoy" value={d ? String(d.tickets) : "…"} hint={day.data ? `Ayer: ${day.data.previous.tickets}` : undefined} />
        <Kpi label="Ventas del mes" value={m ? money(m.net) : "…"} current={m?.net} previous={month.data?.previous.net} />
        <Kpi
          label="Ticket promedio del mes"
          value={m ? money(m.tickets ? m.net / m.tickets : 0) : "…"}
          current={m && m.tickets ? m.net / m.tickets : undefined}
          previous={month.data && month.data.previous.tickets ? month.data.previous.net / month.data.previous.tickets : undefined}
        />
      </div>

      <Panel title="Requiere atención">
        {attention.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todo en orden.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {attention.map((a) => (
              <li key={a.id}>
                <Link
                  to={a.to}
                  className={cn(
                    "flex items-start gap-2 rounded-lg border p-3 text-sm hover:border-primary",
                    a.tone === "critical" ? "border-destructive/40 bg-destructive/5" : "border-amber-500/40 bg-amber-500/5",
                  )}
                >
                  <AlertTriangle className={cn("mt-0.5 h-4 w-4 shrink-0", a.tone === "critical" ? "text-destructive" : "text-amber-600")} />
                  <span>
                    <span className="font-semibold">{a.title}</span>
                    <span className="block text-xs text-muted-foreground">{a.detail}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Más vendidos · 30 días">
          <RankList rows={sellers.map((r) => ({ key: r.variant_id ?? r.name, name: r.name, value: money(r.net), hint: `${formatQty(r.qty)} u.` }))} />
        </Panel>
        <Panel title="Más rentables · 30 días">
          <RankList
            rows={profitable.map((r) => ({ key: r.variant_id ?? r.name, name: r.name, value: money(r.profit ?? 0), hint: `de ${money(r.net)}` }))}
            empty="Carga el costo de los productos para ver su utilidad."
          />
        </Panel>
        <Panel title="Creciendo · vs 30 días anteriores">
          <RankList rows={growing.map((g) => ({ key: g.key, name: g.name, value: `+${money(g.growth)}`, hint: `${money(g.previous)} → ${money(g.net)}` }))} />
        </Panel>
      </div>
      <p className="text-xs text-muted-foreground">
        Más detalle en <Link to="/reportes" className="underline">Reportes</Link>.
      </p>
    </div>
  );
}

function RankList({ rows, empty = "Sin ventas en el periodo." }: { rows: { key: string; name: string; value: string; hint?: string }[]; empty?: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ol className="space-y-2">
      {rows.map((r, i) => (
        <li key={r.key} className="flex items-baseline gap-2 text-sm">
          <span className="num w-4 text-xs text-muted-foreground">{i + 1}</span>
          <span className="min-w-0 flex-1 truncate">{r.name}</span>
          <span className="text-right">
            <span className="num font-semibold">{r.value}</span>
            {r.hint && <span className="block text-[11px] text-muted-foreground">{r.hint}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
