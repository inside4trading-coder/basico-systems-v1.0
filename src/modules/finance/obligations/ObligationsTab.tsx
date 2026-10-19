/**
 * Obligaciones: calendario o lista del mes con indicadores, alertas y filtros.
 * Portado de src/pages/Administracion.tsx, AdminKPIs.tsx, AdminListFilters.tsx
 * y AdminListView.tsx (basicosystems@f551478b).
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/modules/pos/cart";
import { caracasToday } from "@/modules/reports/dates";
import { useAccounts, useInstances, useObligations, type ObligationInstance } from "../api";
import {
  DUE_STATE_LABEL,
  FREQUENCY_LABEL,
  IMPORTANCE_LABEL,
  OBLIGATION_STATUS_LABEL,
  addMonths,
  dueState,
  formatDay,
  isOpen,
  monthLabel,
  monthOf,
  monthRange,
  obligationKpis,
  relativeDay,
  remaining,
  type DueState,
  type Importance,
} from "../lib";
import CalendarView from "./CalendarView";
import { STATE_CHIP } from "./chips";
import { ObligationDialog } from "./dialogs";
import InstanceList from "./InstanceList";
import InstanceSheet from "./InstanceSheet";

type View = "calendar" | "list" | "obligations";
type StateFilter = "all" | "open" | "overdue" | "partial" | "paid" | "skipped" | "void";
const ALL = "all";

const STATE_FILTER_LABEL: Record<StateFilter, string> = {
  all: "Todos los estados",
  open: "Por pagar",
  overdue: "Vencidas",
  partial: "Parciales",
  paid: "Pagadas",
  skipped: "Omitidas",
  void: "Anuladas",
};

const money = (byCurrency: Record<string, number>) => {
  const parts = Object.entries(byCurrency).map(([c, v]) => formatMoney(v, c));
  return parts.length ? parts.join(" · ") : "—";
};

export default function ObligationsTab() {
  const today = caracasToday();
  const [month, setMonth] = useState(monthOf(today));
  const range = monthRange(month);
  const { data: obligations = [] } = useObligations();
  const { data: instances = [], isLoading, error } = useInstances(range.from, range.to);
  const { data: accounts = [] } = useAccounts();
  const [view, setView] = useState<View>("calendar");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<"new" | null>(null);
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});
  const [category, setCategory] = useState(ALL);
  const [responsible, setResponsible] = useState(ALL);
  const [importance, setImportance] = useState<Importance | typeof ALL>(ALL);
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [next7, setNext7] = useState(false);
  const [day, setDay] = useState<string | null>(null);

  const byId = useMemo(() => new Map(obligations.map((o) => [o.id, o])), [obligations]);
  const categories = [...new Set(obligations.map((o) => o.category).filter(Boolean) as string[])].sort();
  const responsibles = [...new Set(obligations.map((o) => o.responsible).filter(Boolean) as string[])].sort();
  const kpis = obligationKpis(instances, month, today);

  const overdue = instances.filter((i) => isOpen(i.status) && i.due_date < today);
  const criticalSoon = instances.filter((i) => {
    const o = byId.get(i.obligation_id);
    const days = (Date.parse(`${i.due_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
    return isOpen(i.status) && (o?.importance === "critical" || o?.importance === "high") && days >= 0 && days <= 3;
  });

  const filtered = instances.filter((i) => {
    const o = byId.get(i.obligation_id);
    const state = dueState(i.due_date, i.status, today);
    if (category !== ALL && o?.category !== category) return false;
    if (responsible !== ALL && o?.responsible !== responsible) return false;
    if (importance !== ALL && o?.importance !== importance) return false;
    if (stateFilter === "open" && !isOpen(i.status)) return false;
    if (stateFilter === "overdue" && state !== "overdue") return false;
    if (["partial", "paid", "skipped", "void"].includes(stateFilter) && i.status !== stateFilter) return false;
    if (next7) {
      const days = (Date.parse(`${i.due_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
      if (!isOpen(i.status) || days < 0 || days > 7) return false;
    }
    if (day && i.due_date !== day) return false;
    // Fuera de "vencidas" y "próximos 7 días", solo el mes que se ve.
    if (stateFilter !== "overdue" && !next7 && !day && !i.due_date.startsWith(month)) return false;
    return true;
  });
  const selected = instances.find((i) => i.id === selectedId) ?? null;
  const filtersOn = category !== ALL || responsible !== ALL || importance !== ALL || stateFilter !== "all" || next7 || Boolean(day);

  const clearFilters = () => {
    setCategory(ALL);
    setResponsible(ALL);
    setImportance(ALL);
    setStateFilter("all");
    setNext7(false);
    setDay(null);
  };

  const alerts: { key: string; text: string; action: () => void; tone: "destructive" | "warning" }[] = [];
  if (overdue.length && !dismissed.overdue)
    alerts.push({
      key: "overdue",
      tone: "destructive",
      text: `${overdue.length} ${overdue.length === 1 ? "cuota vencida" : "cuotas vencidas"} sin pagar`,
      action: () => {
        setStateFilter("overdue");
        setView("list");
      },
    });
  if (criticalSoon.length && !dismissed.critical)
    alerts.push({
      key: "critical",
      tone: "warning",
      text: `${criticalSoon.length} de importancia crítica o alta ${criticalSoon.length === 1 ? "vence" : "vencen"} en 3 días o menos`,
      action: () => {
        setNext7(true);
        setView("list");
      },
    });
  if (kpis.upcoming && !dismissed.upcoming)
    alerts.push({
      key: "upcoming",
      tone: "warning",
      text: `${kpis.upcoming} ${kpis.upcoming === 1 ? "cuota vence" : "cuotas vencen"} en los próximos 7 días`,
      action: () => {
        setNext7(true);
        setView("list");
      },
    });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label={`Total ${monthLabel(month).toLowerCase()}`} value={money(kpis.due)} />
        <Kpi label="Pagado del mes" value={money(kpis.paid)} />
        <Kpi label="Por pagar del mes" value={String(kpis.open)} />
        <Kpi label="Vencidas" value={String(kpis.overdue)} tone={kpis.overdue ? "destructive" : undefined} />
        <Kpi label="Próximos 7 días" value={String(kpis.upcoming)} />
      </div>

      {alerts.map((a) => (
        <div
          key={a.key}
          role="alert"
          className={cn(
            "flex items-center justify-between gap-2 rounded-xl border p-3 text-sm",
            a.tone === "destructive" ? "border-destructive bg-destructive/5" : "border-[hsl(var(--status-warning))] bg-[hsl(var(--status-warning)/0.08)]",
          )}
        >
          <button type="button" className="text-left font-semibold underline-offset-2 hover:underline" onClick={a.action}>
            {a.text}
          </button>
          <button type="button" aria-label="Descartar aviso" onClick={() => setDismissed({ ...dismissed, [a.key]: true })} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" aria-label="Mes anterior" onClick={() => { setMonth(addMonths(month, -1)); setDay(null); }}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[150px] text-center font-semibold">{monthLabel(month)}</span>
          <Button size="icon" variant="ghost" aria-label="Mes siguiente" onClick={() => { setMonth(addMonths(month, 1)); setDay(null); }}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          {month !== monthOf(today) && (
            <Button size="sm" variant="ghost" onClick={() => { setMonth(monthOf(today)); setDay(null); }}>
              Hoy
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Vista">
          {(
            [
              ["calendar", "Calendario"],
              ["list", "Lista"],
              ["obligations", `Obligaciones (${obligations.length})`],
            ] as [View, string][]
          ).map(([v, label]) => (
            <Button key={v} size="sm" variant={view === v ? "default" : "outline"} onClick={() => setView(v)}>
              {label}
            </Button>
          ))}
          <Button size="sm" onClick={() => setEditing("new")}>
            Nueva obligación
          </Button>
        </div>
      </div>

      {view !== "obligations" && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
          <FilterSelect label="Categoría" value={category} onChange={setCategory} options={categories} />
          <FilterSelect label="Responsable" value={responsible} onChange={setResponsible} options={responsibles} />
          <Select value={importance} onValueChange={(v) => setImportance(v as Importance | typeof ALL)}>
            <SelectTrigger className="h-9 w-40" aria-label="Importancia">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Toda importancia</SelectItem>
              {(Object.keys(IMPORTANCE_LABEL) as Importance[]).map((i) => (
                <SelectItem key={i} value={i}>
                  {IMPORTANCE_LABEL[i]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={stateFilter} onValueChange={(v) => setStateFilter(v as StateFilter)}>
            <SelectTrigger className="h-9 w-40" aria-label="Estado">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(STATE_FILTER_LABEL) as StateFilter[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {STATE_FILTER_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={next7} onCheckedChange={setNext7} /> Próximos 7 días
          </label>
          {day && (
            <Badge variant="secondary" className="gap-1">
              Día {formatDay(day)}
              <button type="button" aria-label="Quitar día" onClick={() => setDay(null)}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {filtersOn && (
            <Button size="sm" variant="ghost" onClick={clearFilters}>
              Limpiar filtros
            </Button>
          )}
        </div>
      )}

      {isLoading && <p className="mono-cap text-xs text-muted-foreground">Cargando…</p>}
      {error && <p className="text-sm text-destructive">No se pudo cargar: {error.message}</p>}

      {view === "calendar" && (
        <CalendarView
          month={month}
          today={today}
          instances={filtered}
          obligations={byId}
          onOpen={(i) => setSelectedId(i.id)}
          onDay={(d) => {
            setDay(d);
            setView("list");
          }}
        />
      )}

      {view === "list" && (
        <InstanceList instances={filtered} today={today} obligationName={(id) => byId.get(id)?.name ?? "Obligación"} onOpen={(i) => setSelectedId(i.id)} />
      )}

      {view === "obligations" && (
        <ul className="space-y-2">
          {obligations.map((o) => (
            <li key={o.id}>
              <Link
                to={`/administracion/obligaciones/${o.id}`}
                className={cn("flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3 hover:border-primary", o.status !== "active" && "opacity-60")}
              >
                <div className="min-w-0">
                  <div className="font-semibold">
                    {o.name} {o.status !== "active" && <Badge variant="secondary">{OBLIGATION_STATUS_LABEL[o.status]}</Badge>}{" "}
                    <Badge variant="outline">{IMPORTANCE_LABEL[o.importance]}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {FREQUENCY_LABEL[o.frequency]} desde {formatDay(o.start_date)}
                    {o.category ? ` · ${o.category}` : ""}
                    {o.responsible ? ` · ${o.responsible}` : ""}
                    {o.is_fixed_expense ? " · gasto fijo" : ""}
                  </p>
                </div>
                <span className="num">{o.amount === null ? "Variable" : formatMoney(o.amount, o.currency)}</span>
              </Link>
            </li>
          ))}
          {obligations.length === 0 && (
            <p className="text-sm text-muted-foreground">Carga alquiler, servicios, nómina, impuestos o cualquier pago que se repite para verlos vencer aquí.</p>
          )}
        </ul>
      )}

      {editing && <ObligationDialog obligation={null} accounts={accounts} onClose={() => setEditing(null)} />}
      <InstanceSheet instance={selected} obligation={selected ? byId.get(selected.obligation_id) : undefined} accounts={accounts} onClose={() => setSelectedId(null)} />
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "destructive" }) {
  return (
    <div className={cn("rounded-xl border bg-card p-3", tone === "destructive" && "border-destructive")}>
      <p className="mono-cap text-[10px] text-muted-foreground">{label}</p>
      <p className="num text-lg font-bold">{value}</p>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  if (options.length === 0) return null;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-40" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}: todas</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
