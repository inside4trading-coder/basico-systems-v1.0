/** Una cuenta por pagar: cuotas, pagos, archivos y acciones. */
import { useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useTenant } from "@/core/tenant-context";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/modules/pos/cart";
import { caracasToday } from "@/modules/reports/dates";
import { proofUrl, type FinanceAccount } from "../api";
import { formatDay } from "../lib";
import { ACCEPTED_PROOFS, pickProofs } from "../obligations/proofs";
import { useAttachPayableProofs, useCancelPayable, usePayablePayments, useVoidPayablePayment, type Payable } from "./api";
import { CreditNoteDialog, PayDialog } from "./dialogs";
import { dueLabel, PAYABLE_INSTALLMENT_LABEL, PAYABLE_STATUS_LABEL, payableInstallmentLeft, payableInstallmentState, payableLeft } from "./lib";

const STATE_CLASS = {
  paid: "text-emerald-700 dark:text-emerald-400",
  overdue: "text-destructive font-semibold",
  partial: "text-amber-700 dark:text-amber-400",
  pending: "text-muted-foreground",
} as const;

export default function PayableSheet({ payable, accounts, onClose }: { payable: Payable | null; accounts: FinanceAccount[]; onClose: () => void }) {
  const { can } = useTenant();
  const today = caracasToday();
  const { data: payments = [] } = usePayablePayments(payable?.id ?? null);
  const voidPayment = useVoidPayablePayment();
  const cancel = useCancelPayable();
  const attach = useAttachPayableProofs();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<"pay" | "credit" | null>(null);

  if (!payable) return null;
  const p = payable;
  const left = payableLeft(p);
  const open = p.status === "open";
  const operator = can("finanzas.operar");
  const supervisor = can("finanzas.anular");
  const fail = (title: string) => (err: Error) => toast.error(title, { description: err.message });

  const openProof = async (path: string) => {
    try {
      window.open(await proofUrl(path), "_blank", "noopener");
    } catch (err) {
      toast.error("No se pudo abrir el archivo", { description: (err as Error).message });
    }
  };

  return (
    <>
      <Sheet open onOpenChange={(v) => !v && onClose()}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{p.supplier?.name ?? "Cuenta por pagar"}</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge variant={open ? "default" : "secondary"}>{PAYABLE_STATUS_LABEL[p.status]}</Badge>
              <Badge variant="outline">{p.category === "Proveedores" ? "Mercancía" : p.category}</Badge>
            </div>
            <dl className="grid grid-cols-2 gap-3">
              <Item label="Total" value={formatMoney(p.amount, p.currency)} />
              <Item label="Falta" value={open ? formatMoney(left, p.currency) : "—"} strong />
              {p.subtotal !== null && <Item label="Base" value={formatMoney(p.subtotal, p.currency)} />}
              {p.tax_amount !== null && <Item label="IVA" value={formatMoney(p.tax_amount, p.currency)} />}
              <Item label="Emisión" value={formatDay(p.issued_on)} />
              {p.document && <Item label="Factura" value={p.document} />}
              {p.control_number && <Item label="Control" value={p.control_number} />}
              {p.supplier?.tax_id && <Item label="RIF" value={p.supplier.tax_id} />}
            </dl>
            {p.cancel_reason && <p className="rounded-lg bg-muted/50 p-2 text-xs">Anulada: {p.cancel_reason}</p>}
            {p.note && <p className="rounded-lg bg-muted/50 p-2 text-xs">{p.note}</p>}

            {open && operator && (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setDialog("pay")} disabled={accounts.length === 0}>
                  Pagar
                </Button>
                <Button variant="outline" onClick={() => setDialog("credit")}>
                  Nota de crédito
                </Button>
                {supervisor && payments.every((x) => x.voided_at) && (
                  <Button
                    variant="ghost"
                    className="text-destructive"
                    disabled={cancel.isPending}
                    onClick={() => {
                      const reason = window.prompt("Motivo para anular esta factura");
                      if (!reason?.trim()) return;
                      cancel.mutate({ p_payable_id: p.id, p_reason: reason }, { onSuccess: () => toast.success("Factura anulada"), onError: fail("No se pudo anular") });
                    }}
                  >
                    Anular factura
                  </Button>
                )}
              </div>
            )}
            {open && accounts.length === 0 && <p className="text-xs text-muted-foreground">Crea una cuenta en «Cuentas» para registrar pagos.</p>}

            <section className="space-y-2">
              <h3 className="mono-cap text-[10px] text-muted-foreground">Cuotas</h3>
              <ul className="space-y-1">
                {p.installments.map((i) => {
                  const state = payableInstallmentState(i, today);
                  const pending = payableInstallmentLeft(i) > 0.005;
                  return (
                    <li key={i.id} className="flex items-center justify-between gap-2 rounded-lg border p-2">
                      <div className="min-w-0 text-xs">
                        <p className="font-semibold">
                          {p.installments.length > 1 ? `Cuota ${i.number} · ` : ""}
                          {formatDay(i.due_date)}
                        </p>
                        <p className={STATE_CLASS[state]}>
                          {state === "overdue" ? dueLabel(i.due_date, today) : PAYABLE_INSTALLMENT_LABEL[state]}
                          {open && pending && state !== "overdue" ? ` · ${dueLabel(i.due_date, today)}` : ""}
                        </p>
                        {i.paid > 0 && pending && <p className="text-muted-foreground">Pagado {formatMoney(i.paid, p.currency)}</p>}
                      </div>
                      <span className="num shrink-0 text-xs font-semibold">{formatMoney(i.amount, p.currency)}</span>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="space-y-2">
              <h3 className="mono-cap text-[10px] text-muted-foreground">Pagos</h3>
              {payments.length === 0 && <p className="text-xs text-muted-foreground">Sin pagos todavía.</p>}
              <ul className="space-y-1">
                {payments.map((x) => (
                  <li key={x.id} className={cn("flex items-center justify-between gap-2 rounded-lg border p-2", x.voided_at && "opacity-60")}>
                    <div className="min-w-0 text-xs">
                      <p className={cn("font-semibold", x.voided_at && "line-through")}>
                        {x.kind === "cash" ? `Pago${x.movement?.account ? ` desde ${x.movement.account.name}` : ""}` : "Nota de crédito"}
                      </p>
                      <p className="text-muted-foreground">
                        {formatDay(x.occurred_on)}
                        {x.reference ? ` · Ref. ${x.reference}` : ""}
                        {x.movement && x.movement.currency !== p.currency ? ` · salió ${formatMoney(x.movement.amount, x.movement.currency)}` : ""}
                      </p>
                      {x.note && <p className="text-muted-foreground">{x.note}</p>}
                      {x.voided_at && <p className="text-muted-foreground">Anulado: {x.void_reason}</p>}
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="num text-xs font-semibold">{formatMoney(x.amount, p.currency)}</span>
                      {!x.voided_at && supervisor && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={voidPayment.isPending}
                          onClick={() => {
                            const reason = window.prompt(x.kind === "cash" ? "Motivo para anular este pago (también se anula su salida del libro)" : "Motivo para anular esta nota de crédito");
                            if (!reason?.trim()) return;
                            voidPayment.mutate({ p_payment_id: x.id, p_reason: reason }, { onSuccess: () => toast.success("Anulado"), onError: fail("No se pudo anular") });
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
              <div className="flex items-center justify-between gap-2">
                <h3 className="mono-cap text-[10px] text-muted-foreground">Factura y comprobantes</h3>
                {operator && p.status !== "cancelled" && (
                  <>
                    <Button size="sm" variant="outline" disabled={attach.isPending} onClick={() => fileInput.current?.click()}>
                      <Paperclip /> {attach.isPending ? "Subiendo…" : "Adjuntar"}
                    </Button>
                    <input
                      ref={fileInput}
                      type="file"
                      multiple
                      accept={ACCEPTED_PROOFS}
                      className="hidden"
                      aria-label="Adjuntar factura o comprobante"
                      onChange={(e) => {
                        const files = pickProofs(e.target.files);
                        e.target.value = "";
                        if (files.length === 0) return;
                        attach.mutate({ payableId: p.id, files }, { onSuccess: () => toast.success("Archivo adjuntado"), onError: fail("No se pudo adjuntar") });
                      }}
                    />
                  </>
                )}
              </div>
              {p.proof_paths.length === 0 && <p className="text-xs text-muted-foreground">Sin archivos. Imagen o PDF de hasta 10 MB.</p>}
              <ul className="space-y-1 text-xs">
                {p.proof_paths.map((path) => (
                  <li key={path}>
                    <button type="button" className="truncate text-primary underline-offset-4 hover:underline" onClick={() => openProof(path)}>
                      {path.split("/").pop()?.replace(/^\d+-/, "")}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </SheetContent>
      </Sheet>
      {dialog === "pay" && <PayDialog payable={p} accounts={accounts} onClose={() => setDialog(null)} />}
      {dialog === "credit" && <CreditNoteDialog payable={p} onClose={() => setDialog(null)} />}
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
