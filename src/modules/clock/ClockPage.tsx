/**
 * Fichaje (add-on), como SublimeAdminFichaje (basicosystems@9cb08cd): quién
 * está en turno, historial con revisión en lote, incidencias, métricas
 * (horas, horas extra, puntualidad), personal con PIN y horario, y la
 * ubicación de cada sede. Filtro por periodo y por empleado.
 */
import { useMemo, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { Clock, Copy, ExternalLink, MapPin, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTenant } from "@/core/tenant-context";
import { cn } from "@/lib/utils";
import { useLocations, useSaveLocation } from "@/modules/inventory/api";
import type { Location } from "@/modules/inventory/lib";
import { DataTable, ExportButton, type Column } from "@/modules/reports/components";
import { caracasToday, type DateRange } from "@/modules/reports/dates";
import { CLOCK_PERIOD_LABEL, clockPeriodRange, type ClockPeriod } from "./periods";
import { useClockActions, useClockEvents, useClockKey, useStaffClock, type StaffClock } from "./api";
import {
  DAY_STATUS_LABEL,
  INCIDENT_LABEL,
  KIND_LABEL,
  STATUS_LABEL,
  WEEKDAYS,
  attendanceDays,
  caracasDay,
  dayIncidents,
  dayStatus,
  formatMinutes,
  presenceOf,
  staffMetrics,
  type ClockEvent,
  type ClockKind,
  type DayStatus,
  type DaySummary,
  type Incident,
  type IncidentKind,
  type PresenceState,
  type RadiusByLocation,
  type StaffMetrics,
} from "./lib";

const timeFmt = new Intl.DateTimeFormat("es-VE", { timeZone: "America/Caracas", hour: "2-digit", minute: "2-digit" });
const dateTimeFmt = new Intl.DateTimeFormat("es-VE", { timeZone: "America/Caracas", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const hhmm = (iso: string | null) => (iso ? timeFmt.format(new Date(iso)) : "—");

const PRESENCE: Record<PresenceState, { label: string; className: string }> = {
  fuera: { label: "Sin fichar", className: "bg-muted text-muted-foreground" },
  trabajando: { label: "Trabajando", className: "bg-primary text-primary-foreground" },
  descanso: { label: "En descanso", className: "bg-secondary text-secondary-foreground" },
  salio: { label: "Salió", className: "border text-muted-foreground" },
};

export default function ClockPage() {
  const { active, can } = useTenant();
  const [period, setPeriod] = useState<ClockPeriod>("week");
  const [staffFilter, setStaffFilter] = useState<string>("");
  const range = useMemo<DateRange>(() => clockPeriodRange(period), [period]);
  const today = caracasToday();
  const { data: staff = [] } = useStaffClock();
  const { data: allEvents = [], isLoading } = useClockEvents(range);
  const { data: todayAll = [] } = useClockEvents(useMemo(() => ({ from: today, to: today }), [today]));
  const { data: locations = [] } = useLocations();
  const { data: key } = useClockKey();

  const events = useMemo(() => (staffFilter ? allEvents.filter((e) => e.staff_id === staffFilter) : allEvents), [allEvents, staffFilter]);
  const days = useMemo(() => attendanceDays(events), [events]);
  const radius = useMemo<RadiusByLocation>(() => Object.fromEntries(locations.map((l) => [l.id, l.latitude !== null ? l.clock_radius_m : null])), [locations]);
  const incidents = useMemo(
    () =>
      days.flatMap((d) =>
        dayIncidents(
          d,
          events.filter((e) => e.staff_id === d.staffId && caracasDay(e.event_at) === d.day),
          staff.find((s) => s.id === d.staffId),
          radius,
          today,
        ),
      ),
    [days, events, staff, radius, today],
  );

  if (!can("fichaje.gestionar")) return <Navigate to="/" replace />;

  const nameOf = (id: string) => staff.find((s) => s.id === id)?.name ?? "—";
  const locationName = (id: string | null) => (id ? (locations.find((l) => l.id === id)?.name ?? "—") : "—");
  const pending = events.filter((e) => e.status === "revisar").length;
  const publicUrl = key ? `/fichar/${key}` : null;

  const filters = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Periodo">
        {(Object.keys(CLOCK_PERIOD_LABEL) as ClockPeriod[]).map((p) => (
          <Button key={p} size="sm" variant={period === p ? "default" : "outline"} onClick={() => setPeriod(p)}>
            {CLOCK_PERIOD_LABEL[p]}
          </Button>
        ))}
      </div>
      <select
        aria-label="Empleado"
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        value={staffFilter}
        onChange={(e) => setStaffFilter(e.target.value)}
      >
        <option value="">Todos los empleados</option>
        {staff.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <span className="text-xs text-muted-foreground">
        {range.from === range.to ? range.from : `${range.from} a ${range.to}`}
      </span>
    </div>
  );

  return (
    <AppShell wide>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-primary/10">
            <Clock className="h-5 w-5 text-primary" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl">Fichaje</h1>
            <p className="text-sm text-muted-foreground">Control de asistencia del equipo, desde su teléfono.</p>
          </div>
        </div>
        {publicUrl && (
          <Button asChild variant="outline">
            <a href={publicUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" /> Vista pública
            </a>
          </Button>
        )}
      </div>
      <Tabs defaultValue="turno" className="space-y-4">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="turno">En turno</TabsTrigger>
          <TabsTrigger value="historial">Historial{pending > 0 ? ` (${pending})` : ""}</TabsTrigger>
          <TabsTrigger value="incidencias">Incidencias{incidents.length > 0 ? ` (${incidents.length})` : ""}</TabsTrigger>
          <TabsTrigger value="metricas">Métricas</TabsTrigger>
          <TabsTrigger value="horarios">Personal y horarios</TabsTrigger>
          <TabsTrigger value="sedes">Sedes</TabsTrigger>
        </TabsList>
        <TabsContent value="turno">
          <TodayPanel staff={staff} events={todayAll} locationName={locationName} />
        </TabsContent>
        <TabsContent value="historial" className="space-y-3">
          {filters}
          <HistoryPanel days={days} events={events} staff={staff} loading={isLoading} today={today} nameOf={nameOf} locationName={locationName} range={range} />
        </TabsContent>
        <TabsContent value="incidencias" className="space-y-3">
          {filters}
          <IncidentsPanel incidents={incidents} nameOf={nameOf} />
        </TabsContent>
        <TabsContent value="metricas" className="space-y-3">
          {filters}
          <MetricsPanel days={days} incidents={incidents} staff={staff} nameOf={nameOf} range={range} />
        </TabsContent>
        <TabsContent value="horarios" className="space-y-4">
          <LinkCard canRegenerate={can("fichaje.enlace")} />
          <StaffPanel staff={staff} locationName={locationName} />
        </TabsContent>
        <TabsContent value="sedes">
          <SitesPanel locations={locations.filter((l) => l.is_active && !l.deleted_at)} />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

const DAY_STATUS_CLASS: Record<DayStatus, string> = {
  completa: "border-emerald-500/50 text-emerald-700 dark:text-emerald-400",
  en_turno: "border-primary text-primary",
  no_cerro: "border-destructive/50 text-destructive",
  pendiente: "border-amber-500/50 text-amber-700 dark:text-amber-400",
};

function HistoryPanel({
  days,
  events,
  staff,
  loading,
  today,
  nameOf,
  locationName,
  range,
}: {
  days: DaySummary[];
  events: ClockEvent[];
  staff: StaffClock[];
  loading: boolean;
  today: string;
  nameOf: (id: string) => string;
  locationName: (id: string | null) => string;
  range: DateRange;
}) {
  const cols: Column<DaySummary>[] = [
    { header: "Fecha", value: (r) => r.day },
    { header: "Empleado", value: (r) => nameOf(r.staffId) },
    { header: "Entrada", value: (r) => hhmm(r.firstIn), align: "right" },
    { header: "Salida", value: (r) => (r.open ? "sin marcar" : hhmm(r.lastOut)), align: "right" },
    { header: "Horas", value: (r) => Math.round((r.workedMinutes / 60) * 100) / 100, render: (r) => formatMinutes(r.workedMinutes), align: "right" },
    {
      header: "Estado",
      value: (r) => DAY_STATUS_LABEL[dayStatus(r, today)],
      render: (r) => (
        <Badge variant="outline" className={DAY_STATUS_CLASS[dayStatus(r, today)]}>
          {DAY_STATUS_LABEL[dayStatus(r, today)]}
        </Badge>
      ),
    },
  ];
  return (
    <div className="space-y-4">
      <Card className="space-y-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">Registros</p>
            <p className="text-xs text-muted-foreground">
              {days.length} {days.length === 1 ? "turno" : "turnos"} en el periodo
            </p>
          </div>
          <ExportButton fileName={`fichajes-${range.from}-${range.to}`} rows={days} columns={cols} />
        </div>
        {loading ? <p className="mono-cap text-xs text-muted-foreground">Cargando…</p> : <DataTable rows={days} columns={cols} rowKey={(r) => `${r.staffId}-${r.day}`} empty="Sin fichajes en este periodo." />}
      </Card>
      <MarksPanel events={events} staff={staff} nameOf={nameOf} locationName={locationName} />
    </div>
  );
}

/** Marcas sueltas: revisar una o varias a la vez y registrar a mano. */
function MarksPanel({
  events,
  staff,
  nameOf,
  locationName,
}: {
  events: ClockEvent[];
  staff: StaffClock[];
  nameOf: (id: string) => string;
  locationName: (id: string | null) => string;
}) {
  const { reviewMany } = useClockActions();
  const [onlyPending, setOnlyPending] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const shown = (onlyPending ? events.filter((e) => e.status === "revisar") : events).slice(0, 500);
  const allSelected = shown.length > 0 && shown.every((e) => selected.has(e.id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const decide = (status: "aprobado" | "rechazado", ids: string[]) => {
    const note = status === "rechazado" ? window.prompt(`Motivo para rechazar ${ids.length === 1 ? "el fichaje" : `${ids.length} fichajes`}`) : null;
    if (status === "rechazado" && !note?.trim()) return;
    reviewMany.mutate(
      { eventIds: ids, status, note },
      {
        onSuccess: (n) => {
          toast.success(`${n} ${n === 1 ? "fichaje" : "fichajes"} ${status === "aprobado" ? "aprobados" : "rechazados"}`);
          setSelected(new Set());
        },
        onError: (err) => toast.error("No se pudo guardar", { description: err.message }),
      },
    );
  };

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Marcas</p>
        <ManualEventForm staff={staff} />
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            aria-label="Seleccionar todos"
            checked={allSelected}
            onChange={() => setSelected(allSelected ? new Set() : new Set(shown.map((e) => e.id)))}
          />
          Seleccionar todos
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} />
          Solo pendientes de revisión
        </label>
        {selected.size > 0 && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={reviewMany.isPending} onClick={() => decide("aprobado", [...selected])}>
              Aprobar {selected.size}
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive" disabled={reviewMany.isPending} onClick={() => decide("rechazado", [...selected])}>
              Rechazar {selected.size}
            </Button>
          </div>
        )}
      </div>
      {shown.length === 0 && <p className="text-sm text-muted-foreground">Sin marcas en el periodo.</p>}
      <ul className="divide-y rounded-xl border">
        {shown.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
            <label className="flex min-w-0 items-start gap-2">
              <input type="checkbox" aria-label="Seleccionar fichaje" className="mt-1" checked={selected.has(e.id)} onChange={() => toggle(e.id)} />
              <span className="min-w-0">
                <span className="block">
                  <b>{nameOf(e.staff_id)}</b> · {KIND_LABEL[e.kind]} · <span className="num">{dateTimeFmt.format(new Date(e.event_at))}</span>
                </span>
                <span className="block text-xs text-muted-foreground">
                  {[
                    locationName(e.location_id),
                    e.source === "admin" ? "Registrado a mano" : e.distance_m !== null ? `a ${Math.round(e.distance_m)} m` : "sin ubicación de la sede",
                    e.late_minutes ? `${e.late_minutes} min tarde` : null,
                    e.note,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
            </label>
            <div className="flex items-center gap-2">
              {e.status !== "ok" && <Badge variant={e.status === "rechazado" ? "outline" : "secondary"}>{STATUS_LABEL[e.status]}</Badge>}
              {e.status === "revisar" && (
                <>
                  <Button size="sm" variant="outline" onClick={() => decide("aprobado", [e.id])}>
                    Aprobar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => decide("rechazado", [e.id])}>
                    Rechazar
                  </Button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function IncidentsPanel({ incidents, nameOf }: { incidents: Incident[]; nameOf: (id: string) => string }) {
  const [kind, setKind] = useState<IncidentKind | "all">("all");
  const counts = useMemo(() => {
    const c = {} as Record<IncidentKind, number>;
    (Object.keys(INCIDENT_LABEL) as IncidentKind[]).forEach((k) => (c[k] = incidents.filter((i) => i.kind === k).length));
    return c;
  }, [incidents]);
  const shown = (kind === "all" ? incidents : incidents.filter((i) => i.kind === kind)).sort((a, b) => b.day.localeCompare(a.day));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Tipo de incidencia">
        <Button size="sm" variant={kind === "all" ? "default" : "outline"} onClick={() => setKind("all")}>
          Todas ({incidents.length})
        </Button>
        {(Object.keys(INCIDENT_LABEL) as IncidentKind[]).map((k) => (
          <Button key={k} size="sm" variant={kind === k ? "default" : "outline"} onClick={() => setKind(k)}>
            {INCIDENT_LABEL[k]} ({counts[k]})
          </Button>
        ))}
      </div>
      {shown.length === 0 && <p className="text-sm text-muted-foreground">Sin incidencias en este periodo.</p>}
      <ul className="divide-y rounded-xl border bg-card">
        {shown.map((i, n) => (
          <li key={`${i.staffId}-${i.day}-${i.kind}-${n}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
            <span>
              <b>{nameOf(i.staffId)}</b> · {i.day}
              {i.detail ? <span className="text-muted-foreground"> · {i.detail}</span> : null}
            </span>
            <span className="flex items-center gap-2">
              {i.minutes !== null && <span className="num text-xs">{i.minutes} min</span>}
              <Badge variant="outline" className={i.kind === "pendiente" ? "" : "border-destructive/40 text-destructive"}>
                {INCIDENT_LABEL[i.kind]}
              </Badge>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MetricsPanel({
  days,
  incidents,
  staff,
  nameOf,
  range,
}: {
  days: DaySummary[];
  incidents: Incident[];
  staff: StaffClock[];
  nameOf: (id: string) => string;
  range: DateRange;
}) {
  const rows = useMemo(() => staffMetrics(days, incidents, staff).sort((a, b) => nameOf(a.staffId).localeCompare(nameOf(b.staffId))), [days, incidents, staff, nameOf]);
  const sum = (f: (m: StaffMetrics) => number) => rows.reduce((a, m) => a + f(m), 0);
  const shifts = sum((m) => m.shifts);
  const late = sum((m) => m.lateCount);
  const worked = sum((m) => m.workedMinutes);
  const expected = sum((m) => m.expectedMinutes);
  const cols: Column<StaffMetrics>[] = [
    { header: "Empleado", value: (r) => nameOf(r.staffId) },
    { header: "Turnos", value: (r) => r.shifts, align: "right" },
    { header: "Trabajadas", value: (r) => Math.round((r.workedMinutes / 60) * 100) / 100, render: (r) => formatMinutes(r.workedMinutes), align: "right" },
    { header: "Debía", value: (r) => Math.round((r.expectedMinutes / 60) * 100) / 100, render: (r) => (r.expectedMinutes ? formatMinutes(r.expectedMinutes) : "Sin horario"), align: "right" },
    {
      header: "Cumplimiento",
      value: (r) => (r.expectedMinutes ? Math.round((r.workedMinutes / r.expectedMinutes) * 100) : null),
      render: (r) => (r.expectedMinutes ? `${Math.round((r.workedMinutes / r.expectedMinutes) * 100)} %` : "—"),
      align: "right",
    },
    { header: "Horas extra", value: (r) => Math.round((r.overtimeMinutes / 60) * 100) / 100, render: (r) => formatMinutes(r.overtimeMinutes), align: "right" },
    { header: "Retrasos", value: (r) => r.lateCount, align: "right" },
    { header: "Min. de retraso", value: (r) => r.lateMinutes, align: "right" },
    { header: "Salidas anticipadas", value: (r) => r.earlyCount, align: "right" },
    { header: "Puntualidad", value: (r) => r.punctuality, render: (r) => (r.punctuality === null ? "—" : `${r.punctuality} %`), align: "right" },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Turnos cerrados" value={`${sum((m) => m.closedShifts)} / ${shifts}`} />
        <Kpi label="Trabajadas / Debía" value={`${formatMinutes(worked)}`} hint={expected ? `de ${formatMinutes(expected)}` : "Sin horarios cargados"} />
        <Kpi label="Horas extra" value={formatMinutes(sum((m) => m.overtimeMinutes))} />
        <Kpi label="Puntualidad" value={shifts ? `${Math.round(((shifts - late) / shifts) * 100)} %` : "—"} hint={`${late} ${late === 1 ? "retraso" : "retrasos"}`} />
        <Kpi label="Minutos de retraso" value={String(sum((m) => m.lateMinutes))} />
        <Kpi label="Salidas anticipadas" value={String(sum((m) => m.earlyCount))} />
        <Kpi label="Sin salida marcada" value={String(sum((m) => m.openCount))} />
        <Kpi label="Fuera de radio" value={String(sum((m) => m.outOfRange))} />
      </div>
      <Card className="space-y-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">Detalle por empleado</p>
            <p className="text-xs text-muted-foreground">Las horas extra son lo trabajado por encima de lo que debía cada día según su horario.</p>
          </div>
          <ExportButton fileName={`metricas-fichaje-${range.from}-${range.to}`} rows={rows} columns={cols} />
        </div>
        <DataTable rows={rows} columns={cols} rowKey={(r) => r.staffId} empty="Sin fichajes en este periodo." />
      </Card>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card p-3">
      <p className="mono-cap text-[10px] text-muted-foreground">{label}</p>
      <p className="num text-lg font-bold leading-tight">{value}</p>
      {hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Ubicación de cada sede para fichar: tomarla desde la tienda con el teléfono y ajustar el radio. */
function SitesPanel({ locations }: { locations: Location[] }) {
  const save = useSaveLocation();
  const [locating, setLocating] = useState<string | null>(null);
  const store = (loc: Location, patch: Partial<Location>, message: string) =>
    save.mutate({ ...loc, ...patch }, { onSuccess: () => toast.success(message), onError: (err) => toast.error("No se pudo guardar", { description: err.message }) });
  const takeHere = (loc: Location) => {
    if (!navigator.geolocation) return toast.error("Este equipo no da la ubicación");
    setLocating(loc.id);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(null);
        store(
          loc,
          { latitude: Number(pos.coords.latitude.toFixed(6)), longitude: Number(pos.coords.longitude.toFixed(6)) },
          `Ubicación de ${loc.name} guardada (precisión ${Math.round(pos.coords.accuracy)} m)`,
        );
      },
      (err) => {
        setLocating(null);
        toast.error("No se pudo obtener la ubicación", { description: err.message });
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };
  if (locations.length === 0) return <p className="text-sm text-muted-foreground">Crea una sede en Sedes.</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        El personal solo ficha dentro del radio de su sede. Toma la ubicación estando en la tienda. Sin ubicación, los fichajes de esa sede quedan por revisar.
      </p>
      <ul className="grid gap-3 md:grid-cols-2">
        {locations.map((loc) => (
          <li key={loc.id} className="space-y-3 rounded-xl border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden />
                <p className="font-semibold">{loc.name}</p>
              </div>
              {loc.latitude !== null ? <Badge>Con ubicación</Badge> : <Badge variant="outline">Sin ubicación</Badge>}
            </div>
            {loc.latitude !== null && (
              <p className="num text-xs text-muted-foreground">
                {loc.latitude}, {loc.longitude} ·{" "}
                <a className="underline" href={`https://www.openstreetmap.org/?mlat=${loc.latitude}&mlon=${loc.longitude}#map=18/${loc.latitude}/${loc.longitude}`} target="_blank" rel="noopener noreferrer">
                  ver en el mapa
                </a>
              </p>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor={`radius-${loc.id}`} className="text-xs">
                  Radio (m)
                </Label>
                <Input
                  id={`radius-${loc.id}`}
                  inputMode="numeric"
                  className="h-9 w-24"
                  defaultValue={loc.clock_radius_m}
                  onBlur={(e) => {
                    const n = Math.min(2000, Math.max(20, Math.round(Number(e.target.value)) || 100));
                    e.target.value = String(n);
                    if (n !== loc.clock_radius_m) store(loc, { clock_radius_m: n }, `Radio de ${loc.name}: ${n} m`);
                  }}
                />
              </div>
              <Button variant="outline" disabled={locating === loc.id || save.isPending} onClick={() => takeHere(loc)}>
                {locating === loc.id ? "Ubicando…" : loc.latitude !== null ? "Tomar de nuevo aquí" : "Usar mi ubicación"}
              </Button>
              {loc.latitude !== null && (
                <Button variant="ghost" disabled={save.isPending} onClick={() => store(loc, { latitude: null, longitude: null }, `Se quitó la ubicación de ${loc.name}`)}>
                  Quitar
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TodayPanel({ staff, events, locationName }: { staff: StaffClock[]; events: ClockEvent[]; locationName: (id: string | null) => string }) {
  const enabled = staff.filter((s) => s.is_active && s.clock_enabled);
  if (enabled.length === 0) {
    return <p className="text-sm text-muted-foreground">Nadie ficha todavía. Asigna un PIN en la pestaña Personal.</p>;
  }
  return (
    <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {enabled.map((s) => {
        const mine = events.filter((e) => e.staff_id === s.id);
        const state = presenceOf(mine);
        const first = mine.filter((e) => e.kind === "entrada" && e.status !== "rechazado").at(-1);
        const last = [...mine].sort((a, b) => b.event_at.localeCompare(a.event_at))[0];
        return (
          <li key={s.id} className="space-y-1 rounded-xl border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold">{s.name}</p>
              <span className={cn("rounded-full px-2 py-0.5 text-xs", PRESENCE[state].className)}>{PRESENCE[state].label}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {[s.job_title, locationName(s.location_id) === "—" ? "Todas las sedes" : locationName(s.location_id)].filter(Boolean).join(" · ")}
            </p>
            {first && (
              <p className="text-xs">
                Entrada {hhmm(first.event_at)}
                {first.late_minutes ? <span className="text-destructive"> · {first.late_minutes} min tarde</span> : null}
              </p>
            )}
            {last && last.id !== first?.id && (
              <p className="text-xs text-muted-foreground">
                {KIND_LABEL[last.kind]} {hhmm(last.event_at)}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ManualEventForm({ staff }: { staff: StaffClock[] }) {
  const { addEvent } = useClockActions();
  const [open, setOpen] = useState(false);
  const [staffId, setStaffId] = useState("");
  const [kind, setKind] = useState<ClockKind>("entrada");
  const [at, setAt] = useState("");
  const [note, setNote] = useState("");
  const select = "h-9 rounded-md border border-input bg-background px-2 text-sm";

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Agregar fichaje a mano
      </Button>
    );
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!staffId || !at) return toast.error("Elige la persona y la hora");
    addEvent.mutate(
      { staffId, kind, at: new Date(`${at}:00-04:00`).toISOString(), note },
      {
        onSuccess: () => {
          toast.success("Fichaje registrado");
          setOpen(false);
          setNote("");
        },
        onError: (err) => toast.error("No se pudo registrar", { description: err.message }),
      },
    );
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2 rounded-xl border bg-card p-3">
      <select aria-label="Persona" className={select} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
        <option value="">Persona…</option>
        {staff.filter((s) => s.is_active).map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <select aria-label="Marca" className={select} value={kind} onChange={(e) => setKind(e.target.value as ClockKind)}>
        {(Object.keys(KIND_LABEL) as ClockKind[]).map((k) => (
          <option key={k} value={k}>
            {KIND_LABEL[k]}
          </option>
        ))}
      </select>
      <Input aria-label="Fecha y hora (Caracas)" type="datetime-local" className="h-9 w-auto" value={at} onChange={(e) => setAt(e.target.value)} />
      <Input aria-label="Motivo" className="h-9 min-w-48 flex-1" placeholder="Motivo (obligatorio)" value={note} onChange={(e) => setNote(e.target.value)} />
      <Button size="sm" type="submit" disabled={addEvent.isPending}>
        Registrar
      </Button>
      <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)}>
        Cancelar
      </Button>
    </form>
  );
}

function LinkCard({ canRegenerate }: { canRegenerate: boolean }) {
  const { data: key } = useClockKey();
  const { regenerateKey } = useClockActions();
  const url = key ? `${window.location.origin}/fichar/${key}` : "";
  return (
    <Card className="space-y-2 p-4">
      <p className="mono-cap text-xs text-muted-foreground">Enlace para fichar</p>
      <p className="text-sm text-muted-foreground">
        Compártelo con el personal (por ejemplo, en el grupo de WhatsApp). Cada quien entra desde su teléfono con su PIN y la app
        verifica que esté en la sede.
      </p>
      <div className="flex flex-wrap gap-2">
        <Input readOnly value={url} className="min-w-64 flex-1 font-mono text-xs" aria-label="Enlace de fichaje" />
        <Button
          variant="outline"
          disabled={!url}
          onClick={() => navigator.clipboard.writeText(url).then(() => toast.success("Enlace copiado"), () => toast.error("No se pudo copiar"))}
        >
          <Copy /> Copiar
        </Button>
        {canRegenerate && (
          <Button
            variant="ghost"
            disabled={regenerateKey.isPending}
            onClick={() => {
              if (!window.confirm("El enlace actual dejará de servir. ¿Generar uno nuevo?")) return;
              regenerateKey.mutate(undefined, {
                onSuccess: () => toast.success("Enlace nuevo listo: compártelo otra vez"),
                onError: (err) => toast.error("No se pudo cambiar", { description: err.message }),
              });
            }}
          >
            <RefreshCw /> Cambiar enlace
          </Button>
        )}
      </div>
    </Card>
  );
}

function StaffPanel({ staff, locationName }: { staff: StaffClock[]; locationName: (id: string | null) => string }) {
  const active = staff.filter((s) => s.is_active);
  if (active.length === 0) {
    return <p className="text-sm text-muted-foreground">Agrega al personal en Configuración &gt; Personal.</p>;
  }
  return (
    <ul className="space-y-2">
      {active.map((s) => (
        <StaffRow key={s.id} staff={s} locationName={locationName(s.location_id)} />
      ))}
    </ul>
  );
}

function StaffRow({ staff, locationName }: { staff: StaffClock; locationName: string }) {
  const { setPin, saveSchedule } = useClockActions();
  const [pin, setPinText] = useState("");
  const fail = (err: Error) => toast.error("No se pudo guardar", { description: err.message });
  const save = (patch: Partial<StaffClock>) => saveSchedule.mutate({ id: staff.id, ...patch }, { onError: fail });
  const toggleDay = (d: number) =>
    save({ work_days: staff.work_days.includes(d) ? staff.work_days.filter((x) => x !== d) : [...staff.work_days, d].sort() });

  return (
    <li className="space-y-3 rounded-xl border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold">{staff.name}</p>
          <p className="text-xs text-muted-foreground">{[staff.job_title, locationName === "—" ? "Todas las sedes" : locationName].filter(Boolean).join(" · ")}</p>
        </div>
        {!staff.clock_enabled ? (
          <Badge variant="outline">Sin PIN</Badge>
        ) : staff.pin_temporary ? (
          <Badge variant="secondary" title="La persona crea su PIN personal la primera vez que entra al enlace">PIN temporal</Badge>
        ) : (
          <Badge>PIN personal</Badge>
        )}
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPin.mutate(
            { staffId: staff.id, pin },
            {
              onSuccess: () => {
                toast.success(`PIN temporal asignado a ${staff.name}. Dáselo en persona: al entrar crea el suyo.`);
                setPinText("");
              },
              onError: fail,
            },
          );
        }}
      >
        <div className="space-y-1">
          <Label htmlFor={`pin-${staff.id}`} className="text-xs">
            {staff.clock_enabled ? "Nuevo PIN temporal" : "Asignar PIN temporal"} (6 números)
          </Label>
          <Input
            id={`pin-${staff.id}`}
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            className="h-9 w-32 font-mono tracking-widest"
            value={pin}
            onChange={(e) => setPinText(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        <Button size="sm" type="submit" disabled={pin.length !== 6 || setPin.isPending}>
          Guardar PIN
        </Button>
        {staff.clock_enabled && (
          <Button
            size="sm"
            type="button"
            variant="ghost"
            onClick={() => setPin.mutate({ staffId: staff.id, pin: null }, { onSuccess: () => toast.success("Ya no ficha"), onError: fail })}
          >
            Quitar PIN
          </Button>
        )}
      </form>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Días de trabajo</p>
          <div className="flex gap-1">
            {WEEKDAYS.map((label, d) => (
              <button
                key={label}
                type="button"
                aria-pressed={staff.work_days.includes(d)}
                onClick={() => toggleDay(d)}
                className={cn("h-8 w-10 rounded-md border text-xs", staff.work_days.includes(d) ? "border-primary bg-primary text-primary-foreground" : "bg-background")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <TimeField label="Entrada" value={staff.entry_time} onSave={(v) => save({ entry_time: v })} />
        <TimeField label="Salida" value={staff.exit_time} onSave={(v) => save({ exit_time: v })} />
        <NumberField label="Descanso (min)" value={staff.break_minutes} max={240} onSave={(v) => save({ break_minutes: v })} />
        <NumberField label="Tolerancia (min)" value={staff.late_tolerance} max={120} onSave={(v) => save({ late_tolerance: v })} />
      </div>
    </li>
  );
}

function TimeField({ label, value, onSave }: { label: string; value: string | null; onSave: (v: string | null) => void }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <Input
        type="time"
        aria-label={label}
        className="h-8 w-28"
        defaultValue={value?.slice(0, 5) ?? ""}
        onBlur={(e) => {
          const v = e.target.value || null;
          if (v !== (value?.slice(0, 5) ?? null)) onSave(v);
        }}
      />
    </div>
  );
}

function NumberField({ label, value, max, onSave }: { label: string; value: number; max: number; onSave: (v: number) => void }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <Input
        inputMode="numeric"
        aria-label={label}
        className="h-8 w-24"
        defaultValue={value}
        onBlur={(e) => {
          const n = Math.round(Number(e.target.value));
          if (Number.isFinite(n) && n >= 0 && n <= max && n !== value) onSave(n);
          else e.target.value = String(value);
        }}
      />
    </div>
  );
}
