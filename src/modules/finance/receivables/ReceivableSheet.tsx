/**
 * Una cuenta por cobrar: cuotas, cobros y acciones. Portado de
 * OperationDrawer (AdminCashea.tsx, basicosystems@f551478b).
 */
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useTenant } from "@/core/tenant-context";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/modules/pos/cart";
import { caracasToday } from "@/modules/reports/dates";
import type { FinanceAccount } from "../api";
import { formatDay } from "../lib";
import { useCancelReceivable, useReceivableCollections, useReceivableFinancingPayments, useVoidCollection, type Receivable, type ReceivableInstallment } from "./api";
import { CollectDialog, CommissionDialog, CoverDialog } from "./dialogs";
import { INSTALLMENT_STATE_LABEL, installmentLeft, installmentState } from "./lib";

const STATE_CLASS = {
  paid: "text-emerald-700 dark:text-emerald-400",
  covered: "text-sky-700 dark:text-sky-400",
  overdue: "text-destructive font-semibold",
  partial: "text-amber-700 dark:text-amber-400",
  pending: "text-muted-foreground",
} as const;

const COLLECTION_LABEL = { cash: "Cobro", provider_credit: "Cubierta por la financiadora", commission: "Comisión" } as const;

export default function ReceivableSheet({ receivable, accounts, onClose }: { receivable: Receivable | null; accounts: FinanceAccount[]; onClose: () => void }) {
  const { active, can } = useTenant();
  const today = caracasToday();
  const { data: collections = [] } = useReceivableCollections(receivable?.id ?? null);
  const { data: providerPayments = [] } = useReceivableFinancingPayments(receivable?.id ?? null, receivable?.kind === "financing");
  const voidCollection = useVoidCollection();
  const cancel = useCancelReceivable();
  const [dialog, setDialog] = useState<"collect" | "commission" | null>(null);
  const [covering, setCovering] = useState<ReceivableInstallment | null>(null);

  if (!receivable) return null;
  const r = receivable;
  const left = Math.max(r.amount - r.collected, 0);
  const open = r.status === "open";
  const supervisor = can("finanzas.anular");
  const fail = (title: string) => (err: Error) => toast.error(title, { description: err.message });

  return (
    <>
      <Sheet open onOpenChange={(v) => !v && onClose()}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{r.customer_name ?? r.provider ?? "Cuenta por cobrar"}</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge variant={r.status === "open" ? "default" : "secondary"}>{r.status === "open" ? "Abierta" : r.status === "paid" ? "Cobrada" : "Cancelada"}</Badge>
              <Badge variant="outline">{r.kind === "credit" ? "Crédito" : r.provider}</Badge>
            </div>
            <dl className="grid grid-cols-2 gap-3">
              <Item label="Por cobrar" value={formatMoney(r.amount, r.currency)} />
              <Item label="Falta" value={open ? formatMoney(left, r.currency) : "—"} strong />
              {r.sale_total !== null && <Item label="Venta" value={formatMoney(r.sale_total, r.currency)} />}
              {r.initial_amount > 0 && <Item label="Inicial" value={formatMoney(r.initial_amount, r.currency)} />}
              <Item label="Fecha" value={formatDay(r.issued_on)} />
              {r.document && <Item label="Venta o factura" value={r.document} />}
              {r.external_ref && <Item label="N.º de orden" value={r.external_ref} />}
              {r.customer_doc && <Item label="Documento" value={r.customer_doc} />}
            </dl>
            {r.cancel_reason && <p className="rounded-lg bg-muted/50 p-2 text-xs">Cancelada: {r.cancel_reason}</p>}
            {r.note && <p className="rounded-lg bg-muted/50 p-2 text-xs">{r.note}</p>}

            {open && (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setDialog("collect")} disabled={accounts.length === 0}>
                  Registrar cobro
                </Button>
                {r.kind === "financing" && (
                  <Button variant="outline" onClick={() => setDialog("commission")}>
                    Comisión
                  </Button>
                )}
                {supervisor && collections.every((c) => c.voided_at) && (
                  <Button
                    variant="ghost"
                    className="text-destructive"
                    disabled={cancel.isPending}
                    onClick={() => {
                      const reason = window.prompt("Motivo para cancelar esta cuenta por cobrar");
                      if (!reason?.trim()) return;
                      cancel.mutate({ p_receivable_id: r.id, p_reason: reason }, { onSuccess: () => toast.success("Cancelada"), onError: fail("No se pudo cancelar") });
                    }}
                  >
                    Cancelar
                  </Button>
                )}
              </div>
            )}

            <section className="space-y-2">
              <h3 className="mono-cap text-[10px] text-muted-foreground">Cuotas</h3>
              <ul className="space-y-1">
                {r.installments.map((i) => {
                  const state = installmentState(i, today);
                  return (
                    <li key={i.id} className="flex items-center justify-between gap-2 rounded-lg border p-2">
                      <div className="min-w-0 text-xs">
                        <p className="font-semibold">
                          Cuota {i.number} · {formatDay(i.due_date)}
                        </p>
                        <p className={STATE_CLASS[state]}>
                          {INSTALLMENT_STATE_LABEL[state]}
                          {i.provider_status ? ` · ${r.provider}: ${i.provider_status}` : ""}
                        </p>
                        {(i.collected > 0 || i.covered > 0) && (
                          <p className="text-muted-foreground">
                            {i.collected > 0 ? `Cobrado ${formatMoney(i.collected, r.currency)}` : ""}
                            {i.collected > 0 && i.covered > 0 ? " · " : ""}
                            {i.covered > 0 ? `Cubierto ${formatMoney(i.covered, r.currency)}` : ""}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="num text-xs font-semibold">{formatMoney(i.amount, r.currency)}</span>
                        {open && r.kind === "financing" && installmentLeft(i) > 0.005 && (
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setCovering(i)}>
                            Cubrió {r.provider}
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            {providerPayments.length > 0 && (
              <section className="space-y-2">
                <h3 className="mono-cap text-[10px] text-muted-foreground">Pagos informados por {receivable.provider}</h3>
                <ul className="space-y-1 text-xs">
                  {providerPayments.map((p) => (
                    <li key={p.id} className="flex justify-between gap-2 rounded-lg border p-2">
                      <span>
                        Cuota {p.installment} · {formatDay(p.paid_on)} · Ref. {p.reference}
                      </span>
                      <span className="num">
                        Bs. {p.amount_local.toLocaleString("es-VE", { minimumFractionDigits: 2 })}
                        {p.amount_base !== null ? ` · ${formatMoney(p.amount_base, receivable.currency)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="space-y-2">
              <h3 className="mono-cap text-[10px] text-muted-foreground">Cobros</h3>
              {collections.length === 0 && <p className="text-xs text-muted-foreground">Sin cobros todavía.</p>}
              <ul className="space-y-1">
                {collections.map((c) => (
                  <li key={c.id} className={cn("flex items-center justify-between gap-2 rounded-lg border p-2", c.voided_at && "opacity-60")}>
                    <div className="min-w-0 text-xs">
                      <p className={cn("font-semibold", c.voided_at && "line-through")}>
                        {COLLECTION_LABEL[c.kind]}
                        {c.kind === "cash" ? ` · ${c.payer === "provider" ? r.provider : "cliente"}` : ""}
                      </p>
                      <p className="text-muted-foreground">
                        {formatDay(c.occurred_on)}
                        {c.reference ? ` · Ref. ${c.reference}` : ""}
                      </p>
                      {c.voided_at && <p className="text-muted-foreground">Anulado: {c.void_reason}</p>}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="num text-xs font-semibold">{formatMoney(c.amount, r.currency)}</span>
                      {!c.voided_at && supervisor && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={voidCollection.isPending}
                          onClick={() => {
                            const reason = window.prompt("Motivo para anular este cobro");
                            if (!reason?.trim()) return;
                            voidCollection.mutate(
                              { p_collection_id: c.id, p_reason: reason },
                              { onSuccess: () => toast.success("Cobro anulado"), onError: fail("No se pudo anular") },
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
          </div>
        </SheetContent>
      </Sheet>
      {dialog === "collect" && <CollectDialog receivable={r} accounts={accounts} onClose={() => setDialog(null)} />}
      {dialog === "commission" && <CommissionDialog receivable={r} onClose={() => setDialog(null)} />}
      {covering && <CoverDialog receivable={r} installment={covering} onClose={() => setCovering(null)} />}
    </>
  );
}

function Item({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="mono-cap text-[10px] text-muted-foreground">{label}</dt>
      <dd className={cn("num", strong && "font-semibold")}>{value}</dd>
    </div>
  );
}
