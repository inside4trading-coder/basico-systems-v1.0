/**
 * Fichaje (add-on): quién está trabajando, registros por periodo, horas por
 * persona y configuración del personal (PIN y horario). Portado de
 * SublimeAdminFichaje.tsx (basicosystems@f551478b).
 */
import { useMemo, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTenant } from "@/core/tenant-context";
import { canManageTeam, canSeeReports } from "@/core/tenant-selection";
import { cn } from "@/lib/utils";
import { useLocations } from "@/modules/inventory/api";
import { DataTable, ExportButton, type Column } from "@/modules/reports/components";
import { PRESET_LABEL, caracasToday, presetRange, type DateRange, type RangePreset } from "@/modules/reports/dates";
import { useClockActions, useClockEvents, useClockKey, useStaffClock, type StaffClock } from "./api";
import {
  KIND_LABEL,
  STATUS_LABEL,
  WEEKDAYS,
  attendanceDays,
  caracasDay,
  formatMinutes,
  presenceOf,
  staffTotals,
  type ClockEvent,
  type ClockKind,
  type DaySummary,
  type PresenceState,
  type StaffTotals,
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
  const { active } = useTenant();
  const [preset, setPreset] = useState<RangePreset>("7d");
  const range = useMemo<DateRange>(() => presetRange(preset), [preset]);
  const today = caracasToday();
  const { data: staff = [] } = useStaffClock();
  const { data: events = [], isLoading } = useClockEvents(range);
  const { data: locations = [] } = useLocations();

  if (!canSeeReports(active?.role)) return <Navigate to="/" replace />;

  const nameOf = (id: string) => staff.find((s) => s.id === id)?.name ?? "—";
  const locationName = (id: string | null) => (id ? (locations.find((l) => l.id === id)?.name ?? "—") : "—");
  const pending = events.filter((e) => e.status === "revisar").length;

  return (
    <AppShell wide>
      <div>
        <h1 className="text-2xl">Fichaje</h1>
        <p className="text-sm text-muted-foreground">Entradas, salidas y descansos del personal, desde su teléfono.</p>
      </div>
      <Tabs defaultValue="hoy" className="space-y-4">
        <TabsList>
          <TabsTrigger value="hoy">Hoy</TabsTrigger>
          <TabsTrigger value="registros">Registros{pending > 0 ? ` (${pending})` : ""}</TabsTrigger>
          <TabsTrigger value="horas">Horas</TabsTrigger>
          <TabsTrigger value="personal">Personal</TabsTrigger>
        </TabsList>
        <TabsContent value="hoy">
          <TodayPanel staff={staff} events={events.filter((e) => caracasDay(e.event_at) === today)} locationName={locationName} />
        </TabsContent>
        <TabsContent value="registros" className="space-y-3">
          <PresetPicker value={preset} onChange={setPreset} />
          <RecordsPanel events={events} staff={staff} loading={isLoading} nameOf={nameOf} locationName={locationName} />
        </TabsContent>
        <TabsContent value="horas" className="space-y-3">
          <PresetPicker value={preset} onChange={setPreset} />
          <HoursPanel events={events} nameOf={nameOf} range={range} />
        </TabsContent>
        <TabsContent value="personal" className="space-y-4">
          <LinkCard canRegenerate={canManageTeam(active?.role)} />
          <StaffPanel staff={staff} locationName={locationName} />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

function PresetPicker({ value, onChange }: { value: RangePreset; onChange: (p: RangePreset) => void }) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Periodo">
      {(Object.keys(PRESET_LABEL) as RangePreset[]).map((p) => (
        <Button key={p} size="sm" variant={value === p ? "default" : "outline"} onClick={() => onChange(p)}>
          {PRESET_LABEL[p]}
        </Button>
      ))}
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

function RecordsPanel({
  events,
  staff,
  loading,
  nameOf,
  locationName,
}: {
  events: ClockEvent[];
  staff: StaffClock[];
  loading: boolean;
  nameOf: (id: string) => string;
  locationName: (id: string | null) => string;
}) {
  const { review } = useClockActions();
  const [onlyPending, setOnlyPending] = useState(false);
  const shown = onlyPending ? events.filter((e) => e.status === "revisar") : events;
  const decide = (eventId: string, status: "aprobado" | "rechazado") =>
    review.mutate({ eventId, status }, { onError: (err) => toast.error("No se pudo guardar", { description: err.message }) });

  return (
    <div className="space-y-3">
      <ManualEventForm staff={staff} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} />
        Solo por revisar
      </label>
      {loading && <p className="mono-cap text-xs text-muted-foreground">Cargando…</p>}
      {!loading && shown.length === 0 && <p className="text-sm text-muted-foreground">Sin fichajes en el periodo.</p>}
      <ul className="divide-y rounded-xl border bg-card">
        {shown.slice(0, 500).map((e) => (
          <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
            <div>
              <p>
                <b>{nameOf(e.staff_id)}</b> · {KIND_LABEL[e.kind]} · <span className="num">{dateTimeFmt.format(new Date(e.event_at))}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {[
                  locationName(e.location_id),
                  e.source === "admin" ? "Registrado a mano" : e.distance_m !== null ? `a ${Math.round(e.distance_m)} m` : "sin ubicación de la sede",
                  e.late_minutes ? `${e.late_minutes} min tarde` : null,
                  e.note,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {e.status !== "ok" && <Badge variant={e.status === "rechazado" ? "outline" : "secondary"}>{STATUS_LABEL[e.status]}</Badge>}
              {e.status === "revisar" && (
                <>
                  <Button size="sm" variant="outline" onClick={() => decide(e.id, "aprobado")}>
                    Aprobar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => decide(e.id, "rechazado")}>
                    Rechazar
                  </Button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
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

function HoursPanel({ events, nameOf, range }: { events: ClockEvent[]; nameOf: (id: string) => string; range: DateRange }) {
  const days = useMemo(() => attendanceDays(events), [events]);
  const totals = useMemo(() => staffTotals(days).sort((a, b) => nameOf(a.staffId).localeCompare(nameOf(b.staffId))), [days, nameOf]);
  const totalCols: Column<StaffTotals>[] = [
    { header: "Persona", value: (r) => nameOf(r.staffId) },
    { header: "Días", value: (r) => r.days, align: "right" },
    { header: "Horas", value: (r) => Math.round((r.workedMinutes / 60) * 100) / 100, render: (r) => formatMinutes(r.workedMinutes), align: "right" },
    { header: "Días con atraso", value: (r) => r.lateDays, align: "right" },
    { header: "Minutos de atraso", value: (r) => r.lateMinutes, align: "right" },
    { header: "Días sin salida", value: (r) => r.openDays, align: "right" },
  ];
  const dayCols: Column<DaySummary>[] = [
    { header: "Día", value: (r) => r.day },
    { header: "Persona", value: (r) => nameOf(r.staffId) },
    { header: "Entrada", value: (r) => hhmm(r.firstIn), align: "right" },
    { header: "Salida", value: (r) => (r.open ? "Sin salida" : hhmm(r.lastOut)), align: "right" },
    { header: "Descanso", value: (r) => r.breakMinutes, render: (r) => formatMinutes(r.breakMinutes), align: "right" },
    { header: "Trabajado", value: (r) => Math.round((r.workedMinutes / 60) * 100) / 100, render: (r) => formatMinutes(r.workedMinutes), align: "right" },
    { header: "Atraso (min)", value: (r) => r.lateMinutes, align: "right" },
  ];
  return (
    <div className="space-y-4">
      <Card className="space-y-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="mono-cap text-xs text-muted-foreground">Totales por persona</p>
          <ExportButton fileName={`horas-${range.from}-${range.to}`} rows={totals} columns={totalCols} />
        </div>
        <DataTable rows={totals} columns={totalCols} rowKey={(r) => r.staffId} />
      </Card>
      <Card className="space-y-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="mono-cap text-xs text-muted-foreground">Por día</p>
          <ExportButton fileName={`fichajes-${range.from}-${range.to}`} rows={days} columns={dayCols} />
        </div>
        <DataTable rows={days} columns={dayCols} rowKey={(r) => `${r.staffId}-${r.day}`} />
        <p className="text-xs text-muted-foreground">Sale de las marcas de cada día; las rechazadas no cuentan. Un día sin salida cuenta hasta la última marca.</p>
      </Card>
    </div>
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
        {staff.clock_enabled ? <Badge>Ficha con PIN</Badge> : <Badge variant="outline">Sin PIN</Badge>}
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPin.mutate(
            { staffId: staff.id, pin },
            {
              onSuccess: () => {
                toast.success(`PIN asignado a ${staff.name}. Dáselo en persona.`);
                setPinText("");
              },
              onError: fail,
            },
          );
        }}
      >
        <div className="space-y-1">
          <Label htmlFor={`pin-${staff.id}`} className="text-xs">
            {staff.clock_enabled ? "Cambiar PIN" : "Asignar PIN"} (6 números)
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
