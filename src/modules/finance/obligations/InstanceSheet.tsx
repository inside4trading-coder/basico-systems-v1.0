/**
 * Ficha de una cuota: montos, pagos, comprobantes y acciones. Portado de
 * AdminInstanceSheet.tsx (basicosystems@f551478b).
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useTenant } from "@/core/tenant-context";
import { canSupervise } from "@/core/tenant-selection";
import { formatMoney } from "@/modules/pos/cart";
import { caracasToday } from "@/modules/reports/dates";
import {
  proofUrl,
  useAttachProofs,
  useInstancePayments,
  useReopenInstance,
  useVoidMovement,
  type FinanceAccount,
  type Obligation,
  type ObligationInstance,
} from "../api";
import { DUE_STATE_LABEL, IMPORTANCE_LABEL, dueState, formatDay, isOpen, relativeDay, remaining } from "../lib";
import { EditInstanceDialog, PayDialog, ReasonDialog } from "./dialogs";
import { ACCEPTED_PROOFS, pickProofs } from "./proofs";

export default function InstanceSheet({ instance, obligation, accounts, onClose }: {
  instance: ObligationInstance | null;
  obligation: Obligation | undefined;
  accounts: FinanceAccount[];
  onClose: () => void;
}) {
  const { active } = useTenant();
  const today = caracasToday();
  const payments = useInstancePayments(instance?.id ?? null);
  const attach = useAttachProofs();
  const reopen = useReopenInstance();
  const voidMovement = useVoidMovement();
  const [dialog, setDialog] = useState<"pay" | "edit" | "skip" | "void" | null>(null);

  if (!instance) return null;
  const state = dueState(instance.due_date, instance.status, today);
  const left = remaining(instance);
  const open = isOpen(instance.status);
  const usable = accounts.filter((a) => a.is_active);

  const viewProof = async (path: string) => {
    try {
      window.open(await proofUrl(path), "_blank", "noopener");
    } catch (err) {
      toast.error("No se pudo abrir el comprobante", { description: (err as Error).message });
    }
  };

  return (
    <>
      <Sheet open onOpenChange={(v) => !v && onClose()}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{obligation?.name ?? "Cuota"}</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge variant={state === "overdue" ? "destructive" : "secondary"}>{DUE_STATE_LABEL[state]}</Badge>
              {instance.status === "partial" && <Badge variant="secondary">Pago parcial</Badge>}
              {obligation && <Badge variant="outline">Importancia {IMPORTANCE_LABEL[obligation.importance].toLowerCase()}</Badge>}
              {instance.custom && <Badge variant="outline">Editada</Badge>}
            </div>

            <dl className="grid grid-cols-2 gap-3">
              <div>
                <dt className="mono-cap text-[10px] text-muted-foreground">Vence</dt>
                <dd>
                  {formatDay(instance.due_date)} <span className="text-xs text-muted-foreground">({relativeDay(instance.due_date, today)})</span>
                </dd>
              </div>
              <div>
                <dt className="mono-cap text-[10px] text-muted-foreground">Monto</dt>
                <dd className="num">{instance.amount === null ? "Variable" : formatMoney(instance.amount, instance.currency)}</dd>
              </div>
              <div>
                <dt className="mono-cap text-[10px] text-muted-foreground">Pagado</dt>
                <dd className="num">{formatMoney(instance.paid_amount, instance.currency)}</dd>
              </div>
              <div>
                <dt className="mono-cap text-[10px] text-muted-foreground">Falta</dt>
                <dd className="num font-semibold">{!open ? "—" : left === null ? "Variable" : formatMoney(left, instance.currency)}</dd>
              </div>
              {obligation?.responsible && (
                <div>
                  <dt className="mono-cap text-[10px] text-muted-foreground">Responsable</dt>
                  <dd>{obligation.responsible}</dd>
                </div>
              )}
              {obligation?.payment_method && (
                <div>
                  <dt className="mono-cap text-[10px] text-muted-foreground">Método habitual</dt>
                  <dd>{obligation.payment_method}</dd>
                </div>
              )}
            </dl>
            {(instance.note || instance.void_reason) && <p className="rounded-lg bg-muted/50 p-2 text-xs">{instance.void_reason ?? instance.note}</p>}

            <div className="flex flex-wrap gap-2">
              {open && (
                <Button onClick={() => setDialog("pay")} disabled={usable.length === 0}>
                  {instance.status === "partial" ? "Registrar otro pago" : "Pagar"}
                </Button>
              )}
              {open && (
                <Button variant="outline" onClick={() => setDialog("edit")}>
                  Editar
                </Button>
              )}
              {instance.status === "pending" && (
                <Button variant="ghost" onClick={() => setDialog("skip")}>
                  Omitir
                </Button>
              )}
              {(instance.status === "pending" || instance.status === "skipped") && instance.paid_amount === 0 && (
                <Button variant="ghost" className="text-destructive" onClick={() => setDialog("void")}>
                  Anular
                </Button>
              )}
              {(instance.status === "skipped" || instance.status === "void") && (
                <Button
                  variant="outline"
                  disabled={reopen.isPending}
                  onClick={() =>
                    reopen.mutate(instance.id, {
                      onSuccess: () => toast.success("Cuota reabierta"),
                      onError: (err) => toast.error("No se pudo reabrir", { description: err.message }),
                    })
                  }
                >
                  Reabrir
                </Button>
              )}
            </div>
            {usable.length === 0 && open && <p className="text-xs text-muted-foreground">Crea una cuenta en la pestaña Cuentas para registrar pagos.</p>}

            <section className="space-y-2">
              <h3 className="mono-cap text-[10px] text-muted-foreground">Pagos</h3>
              {(payments.data ?? []).length === 0 && <p className="text-xs text-muted-foreground">Sin pagos registrados.</p>}
              <ul className="space-y-1">
                {(payments.data ?? []).map((p) => (
                  <li key={p.id} className={`flex items-center justify-between gap-2 rounded-lg border p-2 ${p.voided_at ? "opacity-60" : ""}`}>
                    <div className="min-w-0 text-xs">
                      <p className={p.voided_at ? "line-through" : ""}>
                        {formatDay(p.occurred_on)} · {accounts.find((a) => a.id === p.account_id)?.name}
                        {p.reference ? ` · Ref. ${p.reference}` : ""}
                      </p>
                      {p.currency !== instance.currency && p.obligation_amount !== null && (
                        <p className="text-muted-foreground">Cubre {formatMoney(p.obligation_amount, instance.currency)}</p>
                      )}
                      {p.voided_at && <p className="text-muted-foreground">Anulado: {p.void_reason}</p>}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="num text-xs font-semibold">{formatMoney(p.amount, p.currency)}</span>
                      {!p.voided_at && canSupervise(active?.role) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={voidMovement.isPending}
                          onClick={() => {
                            const reason = window.prompt("Motivo para anular este pago");
                            if (!reason?.trim()) return;
                            voidMovement.mutate(
                              { id: p.id, reason },
                              {
                                onSuccess: () => toast.success("Pago anulado; la cuota se recalculó"),
                                onError: (err) => toast.error("No se pudo anular", { description: err.message }),
                              },
                            );
                          }}
                        >
                          Anular
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="space-y-2">
              <h3 className="mono-cap text-[10px] text-muted-foreground">Comprobantes</h3>
              {instance.proof_paths.length === 0 && <p className="text-xs text-muted-foreground">Sin comprobantes.</p>}
              <ul className="space-y-1">
                {instance.proof_paths.map((path) => (
                  <li key={path}>
                    <button type="button" className="text-xs text-primary underline" onClick={() => viewProof(path)}>
                      {path.split("/").pop()?.replace(/^\d+-/, "")}
                    </button>
                  </li>
                ))}
              </ul>
              <label className="block text-xs">
                <span className="text-muted-foreground">Agregar comprobante</span>
                <Input
                  type="file"
                  multiple
                  accept={ACCEPTED_PROOFS}
                  disabled={attach.isPending}
                  onChange={(e) => {
                    const files = pickProofs(e.target.files);
                    e.target.value = "";
                    if (!files.length) return;
                    attach.mutate(
                      { instanceId: instance.id, files },
                      {
                        onSuccess: () => toast.success("Comprobante adjuntado"),
                        onError: (err) => toast.error("No se pudo adjuntar", { description: err.message }),
                      },
                    );
                  }}
                />
              </label>
            </section>

            {obligation && (
              <Link to={`/administracion/obligaciones/${obligation.id}`} className="block text-sm text-primary underline">
                Ver la obligación y su historial
              </Link>
            )}
          </div>
        </SheetContent>
      </Sheet>
      {dialog === "pay" && <PayDialog instance={instance} obligation={obligation} accounts={usable} onClose={() => setDialog(null)} />}
      {dialog === "edit" && <EditInstanceDialog instance={instance} onClose={() => setDialog(null)} />}
      {(dialog === "skip" || dialog === "void") && <ReasonDialog instance={instance} mode={dialog} onClose={() => setDialog(null)} />}
    </>
  );
}
