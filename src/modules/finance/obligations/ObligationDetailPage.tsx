/**
 * Detalle de una obligación: datos, estado, cuotas y bitácora. Portado de
 * src/pages/AdminObligationDetail.tsx (basicosystems@f551478b).
 */
import { useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import BackLink from "@/components/BackLink";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTenant } from "@/core/tenant-context";
import { formatMoney } from "@/modules/pos/cart";
import { caracasToday } from "@/modules/reports/dates";
import { useAccounts, useObligation, useSaveObligation } from "../api";
import { FREQUENCY_LABEL, IMPORTANCE_LABEL, OBLIGATION_STATUS_LABEL, formatDay, isOpen, type ObligationStatus } from "../lib";
import { AddInstanceDialog, ObligationDialog } from "./dialogs";
import { describeEvent } from "./events";
import InstanceList from "./InstanceList";
import InstanceSheet from "./InstanceSheet";

export default function ObligationDetailPage() {
  const { id } = useParams();
  const { active, can } = useTenant();
  const { data, isLoading, error } = useObligation(id);
  const { data: accounts = [] } = useAccounts();
  const save = useSaveObligation();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const today = caracasToday();

  if (!can("finanzas.operar")) return <Navigate to="/" replace />;
  const o = data?.obligation;

  const setStatus = (status: ObligationStatus) => {
    if (!o) return;
    if (status === "cancelled" && !window.confirm(`¿Cancelar ${o.name}? Se quitan sus cuotas futuras sin pagos; las pagadas quedan en el historial.`)) return;
    save.mutate(
      { id: o.id, status },
      {
        onSuccess: () => toast.success(status === "active" ? "Obligación reactivada" : status === "paused" ? "Obligación pausada" : "Obligación cancelada"),
        onError: (err) => toast.error("No se pudo cambiar", { description: err.message }),
      },
    );
  };

  const instances = data?.instances ?? [];
  const shown = showAll ? instances : instances.filter((i) => isOpen(i.status) || i.due_date >= today.slice(0, 7) + "-01" || i.due_date >= today);
  const selected = instances.find((i) => i.id === selectedId) ?? null;
  const paidTotal = instances.reduce((a, i) => a + i.paid_amount, 0);

  return (
    <AppShell wide>
      <BackLink to="/administracion?tab=obligations">Obligaciones</BackLink>
      {isLoading && <p className="mono-cap text-xs text-muted-foreground">Cargando…</p>}
      {error && <p className="text-sm text-destructive">No se pudo cargar: {error.message}</p>}
      {!isLoading && !o && !error && <p className="text-sm text-muted-foreground">No se encontró la obligación.</p>}
      {o && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl">{o.name}</h1>
              <div className="mt-1 flex flex-wrap gap-2">
                <Badge variant={o.status === "active" ? "default" : "secondary"}>{OBLIGATION_STATUS_LABEL[o.status]}</Badge>
                <Badge variant="outline">Importancia {IMPORTANCE_LABEL[o.importance].toLowerCase()}</Badge>
                {o.is_fixed_expense && <Badge variant="outline">Gasto fijo</Badge>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setEditing(true)}>
                Editar
              </Button>
              {o.status !== "cancelled" && (
                <Button variant="outline" onClick={() => setAdding(true)}>
                  Agregar cuota
                </Button>
              )}
              {o.status === "active" && (
                <Button variant="ghost" onClick={() => setStatus("paused")} disabled={save.isPending}>
                  Pausar
                </Button>
              )}
              {o.status !== "active" && (
                <Button variant="ghost" onClick={() => setStatus("active")} disabled={save.isPending}>
                  Reactivar
                </Button>
              )}
              {o.status !== "cancelled" && (
                <Button variant="ghost" className="text-destructive" onClick={() => setStatus("cancelled")} disabled={save.isPending}>
                  Cancelar
                </Button>
              )}
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-3 rounded-xl border bg-card p-4 text-sm md:grid-cols-4">
            <Field label="Monto base" value={o.amount === null ? "Variable" : formatMoney(o.amount, o.currency)} />
            <Field label="Frecuencia" value={FREQUENCY_LABEL[o.frequency]} />
            <Field label={o.frequency === "once" ? "Vence" : "Desde"} value={formatDay(o.start_date)} />
            <Field label="Hasta" value={o.end_date ? formatDay(o.end_date) : "Sin fin"} />
            <Field label="Categoría" value={o.category ?? "—"} />
            <Field label="A quién se paga" value={o.counterparty ?? "—"} />
            <Field label="Responsable" value={o.responsible ?? "—"} />
            <Field label="Método habitual" value={o.payment_method ?? "—"} />
            <Field label="Cuenta habitual" value={accounts.find((a) => a.id === o.account_id)?.name ?? "—"} />
            <Field label="Pagado en total" value={formatMoney(paidTotal, o.currency)} />
            {o.notes && <Field label="Notas" value={o.notes} />}
          </dl>
          {o.status === "paused" && (
            <p className="text-sm text-muted-foreground">Pausada: no se generan cuotas nuevas. Las ya cargadas a mano o con pagos se conservan.</p>
          )}

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm">Cuotas</h2>
              <Button size="sm" variant="ghost" onClick={() => setShowAll(!showAll)}>
                {showAll ? "Solo abiertas y de este mes en adelante" : `Ver todas (${instances.length})`}
              </Button>
            </div>
            <InstanceList instances={[...shown].sort((a, b) => a.due_date.localeCompare(b.due_date))} today={today} obligationName={() => o.name} onOpen={(i) => setSelectedId(i.id)} />
          </section>

          <section className="space-y-2">
            <h2 className="text-sm">Historial de cambios</h2>
            {(data?.events ?? []).length === 0 && <p className="text-sm text-muted-foreground">Sin cambios registrados.</p>}
            <ol className="space-y-1 border-l pl-4">
              {(data?.events ?? []).map((e) => (
                <li key={e.id} className="text-sm">
                  <span className="text-xs text-muted-foreground">
                    {new Date(e.created_at).toLocaleString("es-VE", { timeZone: "America/Caracas", dateStyle: "short", timeStyle: "short" })}
                  </span>{" "}
                  {describeEvent(e, o.currency)}
                </li>
              ))}
            </ol>
          </section>

          {editing && <ObligationDialog obligation={o} accounts={accounts} onClose={() => setEditing(false)} />}
          {adding && <AddInstanceDialog obligation={o} onClose={() => setAdding(false)} />}
          <InstanceSheet instance={selected} obligation={o} accounts={accounts} onClose={() => setSelectedId(null)} />
        </>
      )}
    </AppShell>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="mono-cap text-[10px] text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
