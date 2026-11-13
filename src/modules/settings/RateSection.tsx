/**
 * Configuración → Tasa de cambio. Muestra la tasa con la que cobra el POS, si
 * la consulta automática funciona (última consulta, último error), deja
 * probar la conexión, actualizar ya y poner una tasa de emergencia que rige
 * hasta que entre en vigor una oficial nueva. Port mejorado de la pantalla
 * Tasa BCV de Sublime (basicosystems@f551478b).
 */
import { useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, Pencil, RefreshCcw, Undo2, Wifi } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatRateDate } from "@/core/money";
import { formatDateTime } from "@/modules/inventory/lib";
import { parseAmount } from "@/modules/inventory/import/preview";
import {
  useEndRateOverride,
  useRateStatus,
  useRefreshRate,
  useSetTenantRate,
  useTenantSettings,
  useTestRateConnection,
  useUpdateTenantSettings,
  type RateStatus,
  type RateTestResult,
} from "./api";
import { rateAlert, CHECK_MODE_LABEL, HISTORY_LABEL, sourceLabel } from "./rateStatus";

const fmtRate = (n: number) => n.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const errorToast = (title: string) => (err: Error) => toast.error(title, { description: err.message });

export default function RateSection() {
  const { data: settings } = useTenantSettings();
  const { data: status, isLoading } = useRateStatus();

  if (!settings) return null;
  if (!settings.local_currency) {
    return (
      <Card className="space-y-1 p-4">
        <p className="mono-cap text-xs text-muted-foreground">Tasa de cambio</p>
        <p className="text-sm">Este negocio trabaja solo en {settings.base_currency}: no usa tasa.</p>
      </Card>
    );
  }
  const pair = `${settings.base_currency}/${settings.local_currency}`;
  const official = settings.rate_source === "bcv";

  return (
    <div className="space-y-4">
      {status && <AlertCard status={status} />}
      <CurrentCard pair={pair} status={status} loading={isLoading} />
      {official ? (
        <EmergencyCard base={settings.base_currency} quote={settings.local_currency} status={status} />
      ) : (
        <OwnRateCard base={settings.base_currency} quote={settings.local_currency} />
      )}
      <ModeCard official={official} />
      {status && status.history.length > 0 && <HistoryCard status={status} />}
    </div>
  );
}

function AlertCard({ status }: { status: RateStatus }) {
  const alert = rateAlert(status);
  if (!alert) return null;
  return (
    <Card role="alert" className="space-y-1 border-destructive bg-destructive/10 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
        <AlertTriangle className="h-4 w-4" /> {alert.title}
      </p>
      <p className="text-xs text-destructive">{alert.detail}</p>
    </Card>
  );
}

function CurrentCard({ pair, status, loading }: { pair: string; status: RateStatus | undefined; loading: boolean }) {
  const refresh = useRefreshRate();
  const test = useTestRateConnection();
  const end = useEndRateOverride();
  const [testResult, setTestResult] = useState<RateTestResult | null>(null);
  const current = status?.current ?? null;
  const official = status?.rate_source === "bcv";
  const overrideActive = Boolean(status?.override?.active);
  const busy = refresh.isPending || test.isPending;

  const runRefresh = () =>
    refresh.mutate("refresh", {
      onSuccess: (r) =>
        r.skipped
          ? toast.info(r.reason ?? "Se consultó hace muy poco")
          : toast.success(`Tasa actualizada desde ${r.source === "bcv" ? "el BCV" : "DolarAPI"}`, {
              description: r.errors?.length ? `${r.errors[0]}. Se usó el respaldo.` : undefined,
            }),
      onError: (err) => toast.error("No se pudo actualizar. Se sigue usando la última tasa válida.", { description: err.message }),
    });

  const runTest = () =>
    test.mutate(undefined, {
      onSuccess: (r) => {
        setTestResult(r);
        if (r.ok) toast.success("Conexión correcta");
        else toast.error("Ninguna fuente respondió");
      },
      onError: errorToast("No se pudo probar la conexión"),
    });

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mono-cap text-xs text-muted-foreground">Tasa de cambio {pair}</p>
          {loading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : current ? (
            <>
              <p className="num text-3xl font-bold">{fmtRate(current.rate)}</p>
              <p className="text-xs text-muted-foreground">Bolívares por 1 {pair.split("/")[0]} · es la que usa el POS</p>
            </>
          ) : (
            <p className="text-sm">Todavía no hay tasa.</p>
          )}
        </div>
        {official && status && (
          <Badge variant={status.failing ? "destructive" : "secondary"} className="shrink-0 gap-1">
            {status.failing ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
            {status.failing ? "Con problemas" : "Conectado"}
          </Badge>
        )}
      </div>

      {overrideActive && status?.override && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          <p>
            <span className="font-semibold">Tasa de emergencia</span> puesta el {formatDateTime(status.override.created_at)}
            {status.override.note ? ` · ${status.override.note}` : ""}. Rige hasta que entre en vigor una tasa oficial nueva.
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={end.isPending}
            onClick={() => end.mutate(undefined, { onSuccess: () => toast.success("Volviste a la tasa oficial"), onError: errorToast("No se pudo cambiar") })}
          >
            <Undo2 /> Volver a la tasa oficial
          </Button>
        </div>
      )}

      {current && (
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Field label="Fuente" value={sourceLabel(current.source, overrideActive)} />
          <Field label="Rige desde" value={new Date(`${current.effective_date}T12:00:00`).toLocaleDateString("es-VE")} />
          {official && (
            <>
              <Field
                label="Última consulta"
                value={
                  status?.last_check
                    ? `${formatDateTime(status.last_check.at)} · ${CHECK_MODE_LABEL[status.last_check.mode]} · ${status.last_check.ok ? "bien" : "falló"}`
                    : "Ninguna todavía"
                }
              />
              <Field label="Última consulta buena" value={status?.last_ok_at ? formatDateTime(status.last_ok_at) : "Ninguna todavía"} />
            </>
          )}
        </dl>
      )}

      {official && status?.last_error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
          <p className="text-sm font-semibold text-destructive">Último error</p>
          <p className="break-words text-xs text-destructive">{status.last_error.error}</p>
          <p className="text-xs text-muted-foreground">
            {formatDateTime(status.last_error.at)} · {CHECK_MODE_LABEL[status.last_error.mode]}
          </p>
        </div>
      )}

      {official && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="outline" disabled={busy} onClick={runTest}>
            <Wifi /> Probar conexión
          </Button>
          <Button disabled={busy} onClick={runRefresh}>
            <RefreshCcw className={refresh.isPending ? "animate-spin" : undefined} /> Actualizar tasa ahora
          </Button>
        </div>
      )}

      {testResult && (
        <ul className="space-y-1 rounded-md border p-3 text-sm" aria-label="Resultado de la prueba">
          {testResult.results.map((r) => (
            <li key={r.source} className="flex flex-wrap justify-between gap-2">
              <span className="font-medium">{r.source === "bcv" ? "BCV" : "DolarAPI (respaldo)"}</span>
              {r.ok && r.rate ? (
                <span className="num text-muted-foreground">
                  {fmtRate(r.rate)} · rige {r.effective_date ? formatRateDate(r.effective_date) : "—"}
                </span>
              ) : (
                <span className="break-words text-destructive">{r.error}</span>
              )}
            </li>
          ))}
          <li className="text-xs text-muted-foreground">La prueba no cambia la tasa.</li>
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        {official ? "La tasa oficial se consulta sola cada hora. " : ""}Cada venta guarda la tasa con la que se cobró: cambiar la
        tasa no altera ventas pasadas.
      </p>
    </Card>
  );
}

function RateForm({ submitLabel, pending, onSave }: { submitLabel: string; pending: boolean; onSave: (rate: number, note: string | null, done: () => void) => void }) {
  const [rate, setRate] = useState("");
  const [note, setNote] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const n = parseAmount(rate);
    if (n == null || Number.isNaN(n) || n <= 0) return toast.error("Escribe una tasa válida mayor que cero");
    onSave(n, note.trim() || null, () => {
      setRate("");
      setNote("");
    });
  };
  return (
    <form onSubmit={submit} className="grid gap-2 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
      <div className="space-y-1">
        <Label htmlFor="rate-value">Bolívares por 1 USD</Label>
        <Input id="rate-value" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="Ej. 848,55" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="rate-note">Motivo</Label>
        <Input id="rate-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Opcional" />
      </div>
      <Button type="submit" disabled={pending}>
        <Pencil /> {submitLabel}
      </Button>
    </form>
  );
}

function EmergencyCard({ base, quote, status }: { base: string; quote: string; status: RateStatus | undefined }) {
  const setRate = useSetTenantRate();
  return (
    <Card className="space-y-3 p-4">
      <div>
        <p className="mono-cap text-xs text-muted-foreground">Poner la tasa a mano</p>
        <p className="text-xs text-muted-foreground">
          Úsala cuando el BCV y su respaldo fallen. El POS cobra con ella hasta que entre en vigor una tasa oficial nueva o hasta que
          vuelvas a la oficial.
        </p>
      </div>
      <RateForm
        submitLabel="Guardar tasa de emergencia"
        pending={setRate.isPending}
        onSave={(rate, note, done) =>
          setRate.mutate(
            { base, quote, rate, note, untilOfficial: true },
            {
              onSuccess: () => {
                done();
                toast.success(`Tasa de emergencia: ${fmtRate(rate)}`, {
                  description: status?.current?.effective_date
                    ? "Vence sola cuando el BCV publique una tasa nueva."
                    : undefined,
                });
              },
              onError: errorToast("No se pudo guardar la tasa"),
            },
          )
        }
      />
    </Card>
  );
}

function OwnRateCard({ base, quote }: { base: string; quote: string }) {
  const setRate = useSetTenantRate();
  return (
    <Card className="space-y-3 p-4">
      <div>
        <p className="mono-cap text-xs text-muted-foreground">Tasa propia</p>
        <p className="text-xs text-muted-foreground">El negocio cobra siempre con la última tasa que fijes aquí.</p>
      </div>
      <RateForm
        submitLabel="Fijar"
        pending={setRate.isPending}
        onSave={(rate, note, done) =>
          setRate.mutate(
            { base, quote, rate, note },
            { onSuccess: () => (done(), toast.success(`Tasa fijada en ${fmtRate(rate)}`)), onError: errorToast("No se pudo fijar la tasa") },
          )
        }
      />
    </Card>
  );
}

function ModeCard({ official }: { official: boolean }) {
  const update = useUpdateTenantSettings();
  return (
    <Card className="space-y-2 p-4">
      <p className="mono-cap text-xs text-muted-foreground">Con qué tasa cobra el negocio</p>
      <div className="flex flex-wrap gap-2">
        {(["bcv", "manual"] as const).map((src) => (
          <Button
            key={src}
            size="sm"
            variant={(src === "bcv") === official ? "default" : "outline"}
            disabled={update.isPending}
            onClick={() => (src === "bcv") !== official && update.mutate({ rate_source: src }, { onError: errorToast("No se pudo cambiar") })}
          >
            {src === "bcv" ? "Tasa oficial BCV" : "Siempre mi tasa propia"}
          </Button>
        ))}
      </div>
    </Card>
  );
}

function HistoryCard({ status }: { status: RateStatus }) {
  return (
    <Card className="space-y-2 p-4">
      <p className="mono-cap text-xs text-muted-foreground">Historial de tasas</p>
      <ul className="divide-y text-sm">
        {status.history.map((h, i) => (
          <li key={`${h.at}-${h.source}-${i}`} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
            <span className="text-xs text-muted-foreground">
              {formatDateTime(h.at)} · {HISTORY_LABEL[h.source]} · rige {formatRateDate(h.effective_date)}
              {h.note ? ` · ${h.note}` : ""}
            </span>
            <span className="num font-semibold">{fmtRate(h.rate)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}
