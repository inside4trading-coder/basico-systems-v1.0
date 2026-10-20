/**
 * Ventas desde el POS: las de la caja abierta o buscar por número o cliente;
 * ver el detalle, reimprimir, anular (con la caja de la venta abierta) y
 * devolver. Portado de SublimeVentas y del flujo de devolución de
 * SublimePosApp (basicosystems@f551478b).
 */
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import BackLink from "@/components/BackLink";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useTenant } from "@/core/tenant-context";
import { canSeeReports } from "@/core/tenant-selection";
import { cn } from "@/lib/utils";
import { useCurrentRate, type PaymentMethod } from "@/modules/settings/api";
import { formatMoney, formatQty } from "../cart";
import { parseAmount } from "../usePosMoney";
import { useCreateReturn, useSaleDetail, useSales, useSetInvoice, useVoidSale, type SaleDetail } from "./api";
import { refundInCurrency, returnTotal, returnableQty } from "./returns";

const NO_REFUND = "none";
const when = (iso: string) => new Date(iso).toLocaleString("es-VE", { timeZone: "America/Caracas", dateStyle: "short", timeStyle: "short" });

export default function SalesSheet({ open, onOpenChange, sessionId, sessionOpen, methods, onReprint }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sessionId: string;
  sessionOpen: boolean;
  methods: PaymentMethod[];
  onReprint: (saleId: string) => void;
}) {
  const { active } = useTenant();
  const supervisor = canSeeReports(active?.role);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: sales = [], isLoading } = useSales(sessionId, query);
  const { data: detail } = useSaleDetail(selectedId);
  const [dialog, setDialog] = useState<"void" | "return" | null>(null);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{selectedId ? (detail?.number ?? "Venta") : "Ventas"}</SheetTitle>
          </SheetHeader>
          {!selectedId ? (
            <div className="mt-4 space-y-3">
              <Input
                type="search"
                aria-label="Buscar venta"
                placeholder="Número de venta o cliente (vacío: esta caja)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {isLoading && <p className="mono-cap text-xs text-muted-foreground">Cargando…</p>}
              {!isLoading && sales.length === 0 && <p className="text-sm text-muted-foreground">{query ? "Sin coincidencias." : "Aún no hay ventas en esta caja."}</p>}
              <ul className="space-y-2">
                {sales.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(s.id)}
                      className={cn("flex w-full items-center justify-between gap-2 rounded-xl border p-3 text-left hover:bg-accent", s.status === "voided" && "opacity-60")}
                    >
                      <div className="min-w-0">
                        <p className={cn("mono font-semibold", s.status === "voided" && "line-through")}>{s.number}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {when(s.sold_at)}
                          {s.customer_name ? ` · ${s.customer_name}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="num font-semibold">{formatMoney(s.total, s.base_currency)}</span>
                        {s.status === "voided" && <Badge variant="secondary">Anulada</Badge>}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="mt-4 space-y-4 text-sm">
              <BackLink onClick={() => setSelectedId(null)}>Ventas</BackLink>
              {!detail ? (
                <p className="mono-cap text-xs text-muted-foreground">Cargando…</p>
              ) : (
                <SaleView
                  sale={detail}
                  canVoid={supervisor && detail.status === "completed" && detail.session_id === sessionId && sessionOpen && detail.returns.length === 0}
                  canReturn={supervisor && detail.status === "completed" && detail.items.some((i) => returnableQty(i) > 0)}
                  supervisor={supervisor}
                  onVoid={() => setDialog("void")}
                  onReturn={() => setDialog("return")}
                  onReprint={() => onReprint(detail.id)}
                />
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
      {dialog === "void" && detail && <VoidDialog sale={detail} onClose={() => setDialog(null)} />}
      {dialog === "return" && detail && (
        <ReturnDialog sale={detail} methods={methods} sessionId={sessionOpen ? sessionId : null} onClose={() => setDialog(null)} />
      )}
    </>
  );
}

function SaleView({ sale, canVoid, canReturn, supervisor, onVoid, onReturn, onReprint }: {
  sale: SaleDetail;
  canVoid: boolean;
  canReturn: boolean;
  supervisor: boolean;
  onVoid: () => void;
  onReturn: () => void;
  onReprint: () => void;
}) {
  const cur = sale.base_currency;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={sale.status === "completed" ? "default" : "secondary"}>{sale.status === "completed" ? "Vendida" : "Anulada"}</Badge>
        <span className="text-xs text-muted-foreground">{when(sale.sold_at)}</span>
        {sale.customer_name && <span className="text-xs text-muted-foreground">· {sale.customer_name}</span>}
      </div>
      {sale.void_reason && <p className="rounded-lg bg-muted/50 p-2 text-xs">Anulada: {sale.void_reason}</p>}
      <ul className="divide-y rounded-xl border">
        {sale.items.map((i) => (
          <li key={i.id} className="flex justify-between gap-2 p-2">
            <span className="min-w-0">
              <span className="block truncate">{i.description}</span>
              <span className="text-xs text-muted-foreground">
                {formatQty(i.qty)} u.{i.returned > 0 ? ` · devueltas ${formatQty(i.returned)}` : ""}
              </span>
            </span>
            <span className="num shrink-0">{formatMoney(i.line_total, cur)}</span>
          </li>
        ))}
        <li className="flex justify-between p-2 font-semibold">
          <span>Total</span>
          <span className="num">{formatMoney(sale.total, cur)}</span>
        </li>
      </ul>
      <p className="text-xs text-muted-foreground">Cobro: {sale.payments.map((p) => `${p.method_name} ${formatMoney(p.amount, p.currency)}`).join(" · ")}</p>
      <InvoiceField sale={sale} editable={supervisor} />

      {sale.returns.length > 0 && (
        <section className="space-y-1">
          <h3 className="mono-cap text-[10px] text-muted-foreground">Devoluciones</h3>
          {sale.returns.map((r) => (
            <div key={r.id} className="rounded-lg border p-2 text-xs">
              <p className="font-semibold">
                <span className="mono">{r.number}</span> · {formatMoney(r.total, cur)} · {when(r.created_at)}
              </p>
              <p className="text-muted-foreground">
                {r.items.map((i) => `${formatQty(i.qty)} × ${i.description}`).join(", ")} · {r.reason}
                {r.restock ? "" : " · sin reponer"}
              </p>
              <p className="text-muted-foreground">
                {r.refund_method_name && r.refund_amount !== null
                  ? `Reintegro: ${r.refund_method_name} ${formatMoney(r.refund_amount, r.refund_currency ?? cur)}`
                  : "Sin reintegro"}
              </p>
            </div>
          ))}
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={onReprint}>
          Reimprimir
        </Button>
        {canReturn && <Button onClick={onReturn}>Devolver</Button>}
        {canVoid && (
          <Button variant="ghost" className="text-destructive" onClick={onVoid}>
            Anular venta
          </Button>
        )}
      </div>
      {sale.status === "completed" && !supervisor && (
        <p className="text-xs text-muted-foreground">Anular o devolver lo hace un encargado, administrador o el dueño.</p>
      )}
      {sale.status === "completed" && supervisor && !canVoid && sale.returns.length === 0 && (
        <p className="text-xs text-muted-foreground">Solo se anula con la caja de la venta abierta; si ya cerró, usa Devolver.</p>
      )}
    </>
  );
}

function VoidDialog({ sale, onClose }: { sale: SaleDetail; onClose: () => void }) {
  const voidSale = useVoidSale();
  const [reason, setReason] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    voidSale.mutate(
      { saleId: sale.id, reason },
      {
        onSuccess: () => {
          toast.success(`Venta ${sale.number} anulada`);
          onClose();
        },
        onError: (err) => toast.error("No se pudo anular", { description: err.message }),
      },
    );
  };
  return (
    <Dialog open onOpenChange={(v) => !v && !voidSale.isPending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Anular {sale.number}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Vuelve el stock, sale de la gaveta el efectivo cobrado (y vuelve el vuelto) y se anulan sus entradas en Administración. No se puede deshacer.
          </p>
          <div className="space-y-1">
            <Label htmlFor="void-sale-reason">Motivo *</Label>
            <Input id="void-sale-reason" required value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </div>
          <Button type="submit" variant="destructive" className="h-11 w-full" disabled={voidSale.isPending || !reason.trim()}>
            Anular venta
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReturnDialog({ sale, methods, sessionId, onClose }: { sale: SaleDetail; methods: PaymentMethod[]; sessionId: string | null; onClose: () => void }) {
  const create = useCreateReturn();
  const { data: rate } = useCurrentRate();
  const lines = sale.items.filter((i) => returnableQty(i) > 0);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState(true);
  const usable = methods.filter((m) => m.is_active && m.kind !== "bnpl");
  const [methodId, setMethodId] = useState<string>(NO_REFUND);
  const method = usable.find((m) => m.id === methodId);
  const picked = Object.fromEntries(Object.entries(qty).map(([k, v]) => [k, parseAmount(v)]));
  const total = returnTotal(lines, picked);
  const refund = method ? refundInCurrency(total, method.currency, sale.base_currency, rate?.rate ?? null) : null;
  const cashWithoutSession = method?.kind === "cash" && !sessionId;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const items = lines
      .map((l) => ({ sale_item_id: l.id, qty: Math.min(picked[l.id] ?? 0, returnableQty(l)) }))
      .filter((i) => i.qty > 0);
    if (items.length === 0) return toast.error("Indica cuánto se devuelve");
    create.mutate(
      { saleId: sale.id, items, reason, restock, refundMethodId: method?.id ?? null, sessionId },
      {
        onSuccess: (r) => {
          toast.success(`Devolución ${r.number} registrada`, {
            description: r.refund_amount ? `Reintegro ${formatMoney(Number(r.refund_amount), r.refund_currency ?? sale.base_currency)}` : "Sin reintegro",
          });
          onClose();
        },
        onError: (err) => toast.error("No se pudo registrar", { description: err.message }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(v) => !v && !create.isPending && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Devolver de {sale.number}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <ul className="space-y-2">
            {lines.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 text-sm">
                  <span className="block truncate">{l.description}</span>
                  <span className="text-xs text-muted-foreground">Puede devolver {formatQty(returnableQty(l))}</span>
                </span>
                <Input
                  aria-label={`Cantidad a devolver de ${l.description}`}
                  inputMode="decimal"
                  className="num h-10 w-20"
                  placeholder="0"
                  value={qty[l.id] ?? ""}
                  onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))}
                />
              </li>
            ))}
          </ul>
          <p className="text-sm">
            A devolver: <span className="num font-semibold">{formatMoney(total, sale.base_currency)}</span>
          </p>
          <div className="space-y-1">
            <Label htmlFor="ret-reason">Motivo *</Label>
            <Input id="ret-reason" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="No era la pieza, vino dañada…" />
          </div>
          <label className="flex items-center justify-between gap-2 text-sm">
            Vuelve al inventario
            <Switch checked={restock} onCheckedChange={setRestock} />
          </label>
          <div className="space-y-1">
            <Label htmlFor="ret-method">Reintegro</Label>
            <Select value={methodId} onValueChange={setMethodId}>
              <SelectTrigger id="ret-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_REFUND}>Sin reintegro (cambio o nota de crédito)</SelectItem>
                {usable.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name} · {m.currency}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {method && refund !== null && (
              <p className="text-xs text-muted-foreground">
                Sale {formatMoney(refund, method.currency)}
                {method.kind === "cash" ? " de la gaveta de esta caja" : method.account_id ? " de su cuenta en Administración" : ""}.
              </p>
            )}
            {method && refund === null && <p className="text-xs text-destructive">Sin tasa vigente para reintegrar en {method.currency}.</p>}
            {cashWithoutSession && <p className="text-xs text-destructive">Para reintegrar en efectivo abre una caja.</p>}
          </div>
          <Button type="submit" className="h-11 w-full" disabled={create.isPending || total <= 0 || !reason.trim() || cashWithoutSession || (method !== undefined && refund === null)}>
            Registrar devolución
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** N.º de la factura emitida aparte, para encontrarla desde la venta. */
function InvoiceField({ sale, editable }: { sale: SaleDetail; editable: boolean }) {
  const save = useSetInvoice();
  const [value, setValue] = useState(sale.invoice_number ?? "");
  if (!editable) return sale.invoice_number ? <p className="text-xs text-muted-foreground">Factura: {sale.invoice_number}</p> : null;
  const commit = () => {
    if (value.trim() === (sale.invoice_number ?? "")) return;
    save.mutate(
      { saleId: sale.id, number: value },
      {
        onSuccess: () => toast.success(value.trim() ? "Factura anotada" : "Factura quitada"),
        onError: (err) => toast.error("No se pudo guardar", { description: err.message }),
      },
    );
  };
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">N.º de factura</span>
      <Input
        className="h-8 max-w-48"
        value={value}
        placeholder="Si se facturó aparte"
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
    </label>
  );
}
