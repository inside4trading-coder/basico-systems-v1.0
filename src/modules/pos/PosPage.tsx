/**
 * Punto de venta. Portado de src/pages/pos/SublimePosApp.tsx, PosCatalog.tsx
 * y PosCart.tsx (basicosystems@f551478b): búsqueda por lector, código o texto;
 * carrito con descuentos; cobro mixto y nota de entrega. El total que vale es
 * el que calcula register_sale en el servidor.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeftRight, Minus, Plus, Search, Trash2, UserRound, Wallet } from "lucide-react";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import RateBadge from "@/components/RateBadge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTenant } from "@/core/tenant-context";
import { cn } from "@/lib/utils";
import { useLocations } from "@/modules/inventory/api";
import { useCashiers, usePaymentMethods, useSalesChannels, useTenantSettings } from "@/modules/settings/api";
import { isNetworkError } from "@/core/offline";
import {
  newIdempotencyKey,
  useChangeSessionCashier,
  useOpenSessions,
  useRegisterSale,
  useRegisters,
  type CashSession,
  type PosHit,
  type RegisterSaleInput,
  type SaleReceipt,
} from "./api";
import {
  addToCart,
  cartDiscountAmount,
  currencySymbol,
  cartTotals,
  shelfPrice,
  formatMoney,
  formatQty,
  fromBase,
  removeLine,
  round2,
  saleItems,
  setLineDiscount,
  setQty,
  lineDiscountAmount,
  type CartLine,
  type MoneySettings,
} from "./cart";
import { CashMovementDialog, CloseSessionDialog } from "./CashDialogs";
import { HeldListDialog, HoldDialog } from "./HeldCarts";
import { notifyHoldError, useHeldCarts, useHoldCart, useResumeCart } from "./heldApi";
import OpenSessionScreen from "./OpenSessionScreen";
import PaymentDialog, { type PaymentResult } from "./PaymentDialog";
import ReceiptDialog from "./ReceiptDialog";
import SalesSheet from "./sales/SalesSheet";
import OfflineBar from "./offline/OfflineBar";
import { buildLocalReceipt } from "./offline/localReceipt";
import { useOfflinePos } from "./offline/useOfflinePos";
import { ScanButton } from "@/core/scanner/CameraScanner";
import { useScanner } from "./useScanner";
import { parseAmount, usePosMoney } from "./usePosMoney";
import ManualItemDialog from "./ManualItemDialog";
import { CatalogPanel, ProductCard, ProductGrid } from "./ProductCard";
import SessionAlerts from "./SessionAlerts";
import DualPrice from "./DualPrice";
import FunctionsBar, { type PosFunction } from "./FunctionsBar";
import CouponDialog from "./CouponDialog";
import { couponDiscount, type AppliedCoupon } from "./coupons";

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sin almacenamiento: el carrito vive solo en memoria.
  }
}

export default function PosPage() {
  const { active } = useTenant();
  const storageKey = `pos.session.${active?.tenant.id}`;
  const [sessionId, setSessionId] = useState<string | null>(() => readStorage(storageKey, null));
  const sessions = useOpenSessions();
  const found = (sessions.data ?? []).find((s) => s.id === sessionId) ?? null;
  // Al cerrar, la sesión sale de las abiertas; se mantiene la pantalla hasta
  // que el cajero vea el resultado del cierre.
  const [pinned, setPinned] = useState<CashSession | null>(null);
  useEffect(() => {
    if (found) setPinned(found);
  }, [found]);
  const session = found ?? (pinned?.id === sessionId ? pinned : null);

  const choose = (id: string | null) => {
    setSessionId(id);
    writeStorage(storageKey, id);
  };

  return (
    <AppShell wide>
      {sessions.isLoading ? (
        <p className="mono-cap text-xs text-muted-foreground">Cargando…</p>
      ) : session ? (
        <Terminal session={session} onLeave={() => choose(null)} />
      ) : (
        <OpenSessionScreen onSelect={choose} />
      )}
    </AppShell>
  );
}

interface CartDraft {
  lines: CartLine[];
  discountMode: "amount" | "percent";
  discountValue: string;
  /** Nota del pedido; se lleva al cobro. */
  note?: string;
  /** Cupón aplicado (se valida otra vez en el servidor al cobrar). */
  coupon?: AppliedCoupon | null;
}

const EMPTY_DRAFT: CartDraft = { lines: [], discountMode: "amount", discountValue: "", note: "" };

function Terminal({ session, onLeave }: { session: CashSession; onLeave: () => void }) {
  const { active } = useTenant();
  const { money, stale, currencies, pricesIncludeTax } = usePosMoney();
  const { data: tenantSettings } = useTenantSettings();
  const { data: channels = [] } = useSalesChannels();
  const { data: allCashiers = [] } = useCashiers();
  const cashiers = allCashiers.filter((c) => c.is_active && c.works_pos && (!c.location_id || c.location_id === session.location_id));
  // Quién atiende: el de la sesión (se elige al abrir y se releva con «Cambiar cajero»).
  const cashier = allCashiers.find((c) => c.id === session.cashier_id) ?? null;
  const [changingCashier, setChangingCashier] = useState(false);
  const changeCashier = useChangeSessionCashier();
  const { data: methods = [] } = usePaymentMethods();
  const { data: registers = [] } = useRegisters();
  const { data: locations = [] } = useLocations();
  const offline = useOfflinePos(active?.tenant.id ?? "none", session.location_id);
  const searchCatalog = offline.search;
  const register = registers.find((r) => r.id === session.register_id);
  const location = locations.find((l) => l.id === session.location_id);

  const draftKey = `pos.cart.${session.id}`;
  const [draft, setDraft] = useState<CartDraft>(() => readStorage(draftKey, EMPTY_DRAFT));
  useEffect(() => writeStorage(draftKey, draft.lines.length > 0 ? draft : null), [draftKey, draft]);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PosHit[]>([]);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [paying, setPaying] = useState(false);
  const [moving, setMoving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [holding, setHolding] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const held = useHeldCarts<CartDraft>(session.location_id, offline.online);
  const hold = useHoldCart(session.location_id);
  const resume = useResumeCart<CartDraft>(session.location_id);
  const [history, setHistory] = useState(false);
  const [receipt, setReceipt] = useState<{ saleId: string } | { local: SaleReceipt } | null>(null);
  const [localResults, setLocalResults] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [couponOpen, setCouponOpen] = useState(false);
  const discountRef = useRef<HTMLInputElement>(null);
  const cartRef = useRef<HTMLElement>(null);
  const cartHeight = useFitToViewport(cartRef);
  const lastSaleKey = `pos.lastSale.${session.id}`;
  const [lastSaleId, setLastSaleId] = useState<string | null>(() => readStorage(lastSaleKey, null));
  const idempotencyKey = useRef<string | null>(null);
  const sale = useRegisterSale();

  const afterLineDiscounts = round2(draft.lines.reduce((a, l) => a + round2(l.price * l.qty) - l.discount, 0));
  // El cupón va primero; el descuento manual se calcula sobre lo que queda.
  const couponOff = couponDiscount(draft.coupon, afterLineDiscounts);
  const couponShort = Boolean(draft.coupon) && couponOff === 0;
  const manualDiscount = cartDiscountAmount(draft.discountMode, parseAmount(draft.discountValue), round2(afterLineDiscounts - couponOff));
  const cartDiscount = round2(couponOff + manualDiscount);
  const totals = cartTotals(draft.lines, cartDiscount, pricesIncludeTax);

  const add = useCallback((hit: PosHit) => {
    if (hit.price === null || hit.price <= 0) return toast.error(`${hit.product_name} no tiene precio`);
    if (hit.available <= 0) return toast.error(`Sin existencia de ${hit.product_name} en esta sede`);
    setDraft((d) => {
      const inCart = d.lines.find((l) => l.variantId === hit.variant_id)?.qty ?? 0;
      if (inCart >= hit.available) toast.error(`Solo hay ${formatQty(hit.available)} de ${hit.product_name}`);
      return {
        ...d,
        lines: addToCart(d.lines, {
          variantId: hit.variant_id,
          productId: hit.product_id,
          name: hit.product_name,
          options: hit.options ?? {},
          sku: hit.sku,
          unit: hit.unit,
          price: Number(hit.price),
          taxRate: hit.tax_rate,
          available: hit.available,
        }),
      };
    });
  }, []);

  const runSearch = useCallback(
    async (text: string, addExact: boolean) => {
      const q = text.trim();
      if (!q) return setHits([]);
      setSearching(true);
      try {
        const { hits: found, local } = await searchCatalog(q);
        setLocalResults(local);
        // Código exacto (lector o tecleado + Enter) con un solo resultado: directo al carrito.
        if (addExact && found.length === 1 && found[0].match_kind !== "texto") {
          add(found[0]);
          setQuery("");
          setHits([]);
        } else {
          setHits(found);
          if (found.length === 0) toast.error(`Nada coincide con «${q}»`);
        }
      } catch (err) {
        toast.error("No se pudo buscar", { description: (err as Error).message });
      } finally {
        setSearching(false);
      }
    },
    [add, searchCatalog],
  );

  // Búsqueda mientras se escribe, con pausa para no consultar en cada tecla.
  useEffect(() => {
    const q = query.trim();
    // Buscador vacío: vuelve el catálogo de la sede.
    if (!q) setHits([]);
    if (q.length < 2) return;
    const t = setTimeout(() => runSearch(q, false), 300);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  useScanner((code) => runSearch(code, true), !paying && !moving && !closing && !receipt);

  const pick = (hit: PosHit) => {
    add(hit);
    searchRef.current?.focus();
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    runSearch(query, true);
  };

  const openPayment = () => {
    if (!money) return;
    if (draft.lines.length === 0) return toast.error("El carrito está vacío");
    if (totals.total <= 0) return toast.error("El total debe ser mayor que cero");
    if (couponShort) return toast.error(`El cupón ${draft.coupon!.code} no aplica a esta compra`, { description: "Quítalo o agrega productos." });
    idempotencyKey.current = newIdempotencyKey();
    setPaying(true);
  };

  const finishSale = () => {
    idempotencyKey.current = null;
    setPaying(false);
    setDraft(EMPTY_DRAFT);
    setHits([]);
  };

  // Sin red (o si se cae al cobrar) la venta va a la cola con la hora del cobro
  // y la misma clave: al sincronizar el servidor la registra una sola vez.
  const queueOffline = async (input: RegisterSaleInput, result: PaymentResult) => {
    const local = buildLocalReceipt({
      key: input.idempotencyKey,
      soldAt: input.soldAt!,
      lines: draft.lines,
      cartDiscount: totals.cartDiscount,
      pricesIncludeTax,
      payments: result.payments,
      methods,
      money: money!,
      change: result.change,
      customer: result.customer,
      note: result.note,
    });
    await offline.queueSale({
      key: input.idempotencyKey,
      sessionId: session.id,
      soldAt: input.soldAt!,
      input,
      receipt: local,
      status: "pending",
      attempts: 0,
      error: null,
    });
    toast.warning("Venta guardada sin conexión", { description: "Se registra sola cuando vuelva la conexión." });
    finishSale();
    setReceipt({ local });
  };

  const confirm = async (result: PaymentResult) => {
    const key = idempotencyKey.current ?? newIdempotencyKey();
    idempotencyKey.current = key;
    const input: RegisterSaleInput = {
      idempotencyKey: key,
      sessionId: session.id,
      items: saleItems(draft.lines),
      payments: result.payments.map((p) => ({ payment_method_id: p.methodId, amount: p.amount, reference: p.reference, bank: p.bank, extra: p.extra })),
      cartDiscount: totals.cartDiscount,
      change: result.change,
      customer: result.customer,
      note: result.note,
      channelId: result.channelId,
      cashierId: cashier?.id ?? null,
      coupon: draft.coupon && couponOff > 0 ? { code: draft.coupon.code, discount: couponOff } : null,
    };
    const soldAt = new Date().toISOString();
    if (!navigator.onLine) {
      if (input.coupon) return toast.error("El cupón necesita conexión", { description: "Quítalo para cobrar sin conexión." });
      return queueOffline({ ...input, soldAt }, result);
    }
    try {
      const res = await sale.mutateAsync(input);
      if (Math.abs(res.total - totals.total) >= 0.01) {
        toast.warning(`El servidor calculó ${formatMoney(res.total, money!.baseCurrency)}`);
      }
      finishSale();
      setLastSaleId(res.sale_id);
      writeStorage(lastSaleKey, res.sale_id);
      setReceipt({ saleId: res.sale_id });
    } catch (err) {
      if (isNetworkError(err) && !input.coupon) return queueOffline({ ...input, soldAt }, result);
      toast.error("No se registró la venta", { description: (err as Error).message });
    }
  };

  const base = money?.baseCurrency ?? active?.tenant.base_currency ?? "USD";
  const hasLines = draft.lines.length > 0;

  const onFunction = (id: PosFunction) => {
    switch (id) {
      case "manual":
        return setManualOpen(true);
      case "note":
        return setNoteOpen(true);
      case "cash":
        return setMoving(true);
      case "coupon":
        if (!hasLines) return toast.info("Agrega productos para aplicar un cupón");
        return setCouponOpen(true);
      case "discount":
        if (!hasLines) return toast.info("Agrega productos para aplicar un descuento");
        return discountRef.current?.focus();
      case "suspend":
        if (!hasLines) return toast.info("El carrito está vacío");
        return setHolding(true);
      case "resume":
        return setHeldOpen(true);
      case "return":
        toast.info("Elige la venta y usa «Devolver»");
        return setHistory(true);
      case "history":
        return setHistory(true);
      case "reprint":
        if (!lastSaleId) return toast.info("Aún no hay ventas en esta caja", { description: "Busca una venta anterior en Historial." });
        return setReceipt({ saleId: lastSaleId });
      case "close":
        return setClosing(true);
      default:
        return;
    }
  };

  return (
    <div className="space-y-3 pb-24 lg:pb-0">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3">
        <dl className="flex flex-wrap items-end gap-x-5 gap-y-2 text-sm">
          <HeaderField label="Sede" value={location?.name ?? "—"} />
          <HeaderField label="Caja" value={register?.name ?? "Caja"} />
          <HeaderField label="Sesión" value={<span className="mono">{session.number}</span>} />
          <div>
            <dt className="mono-cap text-[10px] text-muted-foreground">Cajero</dt>
            <dd className="font-semibold">{cashier?.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="mono-cap text-[10px] text-muted-foreground">Tasa</dt>
            <dd>
              <RateBadge className="text-foreground" />
            </dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2">
          {cashiers.length > 0 && (
            <Button size="sm" variant="outline" disabled={!offline.online} title={offline.online ? undefined : "Necesita conexión"} onClick={() => setChangingCashier(true)}>
              <UserRound className="h-4 w-4" /> Cambiar cajero
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={!offline.online} title={offline.online ? undefined : "Necesita conexión"} onClick={() => setMoving(true)}>
            <Wallet className="h-4 w-4" /> Movimientos de caja
          </Button>
          <Button size="sm" variant="ghost" onClick={onLeave}>
            <ArrowLeftRight className="h-4 w-4" /> Cambiar caja
          </Button>
        </div>
      </header>

      <SessionAlerts
        openedAt={session.opened_at}
        reminderTime={tenantSettings?.closing_reminder_time}
        canClose={offline.online}
        onClose={() => setClosing(true)}
      />
      <OfflineBar offline={offline} sessionId={session.id} />

      {stale && offline.online && (
        <p role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">
          La tasa no está al día. Actualízala en Configuración antes de cobrar en bolívares.
        </p>
      )}

      <FunctionsBar
        online={offline.online}
        badges={{ resume: held.data?.length ?? 0 }}
        active={{ note: Boolean(draft.note?.trim()), coupon: Boolean(draft.coupon) }}
        onAction={onFunction}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
        <section className="min-w-0 space-y-3" aria-label="Catálogo">
          <form onSubmit={submitSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Escanea o busca por código, nombre o atributo"
                className="h-12 pl-9 text-base"
                aria-label="Buscar producto"
                autoFocus
              />
            </div>
            <ScanButton className="h-12" showLabel onScan={(code) => runSearch(code, true)} />
          </form>
          <ManualItemDialog
            open={manualOpen}
            onOpenChange={setManualOpen}
            money={money}
            onAdd={(line) => setDraft((d) => ({ ...d, lines: [...d.lines, line] }))}
          />
          {searching && <p className="mono-cap text-xs text-muted-foreground">Buscando…</p>}
          {!searching && localResults && hits.length > 0 && (
            <p className="text-xs text-muted-foreground">Sin conexión: resultados del catálogo guardado en este equipo.</p>
          )}
          {query.trim() === "" && hits.length === 0 ? (
            <CatalogPanel
              locationId={session.location_id}
              online={offline.online}
              money={money}
              baseCurrency={base}
              pricesIncludeTax={pricesIncludeTax}
              onPick={pick}
            />
          ) : (
            <ProductGrid>
              {hits.map((h) => (
                <li key={h.variant_id}>
                  <ProductCard hit={h} money={money} baseCurrency={base} pricesIncludeTax={pricesIncludeTax} onPick={pick} />
                </li>
              ))}
            </ProductGrid>
          )}
        </section>

        {/* El carrito tiene su propio scroll: totales y Cobrar quedan siempre a la vista. */}
        <section
          ref={cartRef}
          style={cartHeight ? { height: cartHeight } : undefined}
          className="flex flex-col rounded-xl border bg-card lg:sticky lg:top-4 lg:self-start"
          aria-label="Carrito"
        >
          <div className="flex items-center justify-between gap-2 border-b p-3">
            <h2 className="text-base">
              Carrito
              {hasLines && (
                <span className="num ml-2 rounded-full bg-foreground px-2 py-0.5 text-xs text-background">
                  {formatQty(draft.lines.reduce((a, l) => a + l.qty, 0))} und.
                </span>
              )}
            </h2>
            {hasLines && (
              <Button size="sm" variant="ghost" onClick={() => setDraft(EMPTY_DRAFT)}>
                Vaciar
              </Button>
            )}
          </div>
          <div className="min-h-[120px] flex-1 overflow-y-auto p-3">
            {!hasLines && <p className="py-8 text-center text-sm text-muted-foreground">Escanea o elige un producto del catálogo.</p>}
            <ul className="space-y-2">
              {draft.lines.map((l) => (
                <CartRow
                  key={l.variantId}
                  line={l}
                  total={totals.lines.find((t) => t.variantId === l.variantId)?.total ?? 0}
                  currency={base}
                  money={money}
                  pricesIncludeTax={pricesIncludeTax}
                  onQty={(qty) => setDraft((d) => ({ ...d, lines: setQty(d.lines, l.variantId, qty) }))}
                  onDiscount={(v) => setDraft((d) => ({ ...d, lines: setLineDiscount(d.lines, l.variantId, v) }))}
                  onRemove={() => setDraft((d) => ({ ...d, lines: removeLine(d.lines, l.variantId) }))}
                />
              ))}
            </ul>
          </div>

          <div className="space-y-3 border-t p-3">
            {hasLines && (
              <div className="flex items-center gap-2 text-sm">
                <span className="shrink-0">Descuento</span>
                <Input
                  ref={discountRef}
                  inputMode="decimal"
                  aria-label="Descuento del carrito"
                  value={draft.discountValue}
                  onChange={(e) => setDraft((d) => ({ ...d, discountValue: e.target.value }))}
                  className="num h-9"
                  placeholder="0"
                />
                <div className="flex shrink-0">
                  {(["amount", "percent"] as const).map((m) => (
                    <Button key={m} size="sm" variant={draft.discountMode === m ? "default" : "outline"} onClick={() => setDraft((d) => ({ ...d, discountMode: m }))}>
                      {m === "amount" ? currencySymbol(base) : "%"}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {draft.note?.trim() && (
              <button
                type="button"
                onClick={() => setNoteOpen(true)}
                className="block w-full truncate rounded-md border border-dashed px-2 py-1 text-left text-xs text-muted-foreground"
              >
                Nota: {draft.note}
              </button>
            )}
            {draft.coupon && (
              <div className={cn("flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-xs", couponShort && "border-destructive text-destructive")}>
                <span className="truncate">
                  Cupón <span className="mono font-semibold">{draft.coupon.code}</span>
                  {couponShort ? ` · pide compra desde ${formatMoney(draft.coupon.minPurchase, base)}` : ` · −${formatMoney(couponOff, base)}`}
                </span>
                <button type="button" className="shrink-0 underline" onClick={() => setDraft((d) => ({ ...d, coupon: null }))}>
                  Quitar
                </button>
              </div>
            )}
            <dl className="space-y-1 text-sm">
              <Row label="Subtotal" value={<DualInline amount={totals.subtotal} base={base} money={money} />} />
              {totals.discount > 0 && (
                <Row
                  label="Descuentos"
                  value={
                    <>
                      −<DualInline amount={totals.discount} base={base} money={money} />
                    </>
                  }
                />
              )}
              <Row label={pricesIncludeTax ? "Impuesto incluido" : "IVA"} value={<DualInline amount={totals.tax} base={base} money={money} />} />
              <div className="flex items-start justify-between pt-1">
                <dt className="font-bold">Total</dt>
                <dd className="text-right">
                  <DualPrice amount={totals.total} baseCurrency={base} money={money} size="lg" className="items-end" />
                </dd>
              </div>
            </dl>
            <Button size="lg" className="h-14 w-full text-base" disabled={!hasLines || !money} onClick={openPayment}>
              Cobrar
            </Button>
          </div>
        </section>
      </div>

      {/* En el teléfono, el cobro queda fijo abajo mientras se agregan productos. */}
      {hasLines && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t bg-background p-3 lg:hidden">
          <DualPrice amount={totals.total} baseCurrency={base} money={money} />
          <Button size="lg" className="h-12 flex-1" disabled={!money} onClick={openPayment}>
            Cobrar
          </Button>
        </div>
      )}

      <Dialog open={changingCashier} onOpenChange={setChangingCashier}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Quién atiende la caja?</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2 sm:grid-cols-2">
            {cashiers.map((c) => (
              <Button
                key={c.id}
                variant={c.id === cashier?.id ? "default" : "outline"}
                className="h-auto justify-start py-3 text-left"
                disabled={changeCashier.isPending}
                onClick={() =>
                  changeCashier.mutate(
                    { sessionId: session.id, cashierId: c.id },
                    {
                      onSuccess: () => {
                        toast.success(`Ahora atiende ${c.name}`);
                        setChangingCashier(false);
                      },
                      onError: (err) => toast.error("No se pudo cambiar el cajero", { description: err.message }),
                    },
                  )
                }
              >
                <span>
                  {c.name}
                  {c.job_title && <span className="block text-[11px] font-normal opacity-70">{c.job_title}</span>}
                </span>
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <CouponDialog
        open={couponOpen}
        onOpenChange={setCouponOpen}
        base={afterLineDiscounts}
        currency={base}
        onApply={(coupon) => setDraft((d) => ({ ...d, coupon }))}
      />

      <NoteDialog open={noteOpen} onOpenChange={setNoteOpen} value={draft.note ?? ""} onSave={(note) => setDraft((d) => ({ ...d, note }))} />

      {money && (
        <PaymentDialog
          open={paying}
          onOpenChange={setPaying}
          total={totals.total}
          money={money}
          methods={methods}
          channels={channels.filter((c) => c.is_active)}
          channelRequired={tenantSettings?.channel_required ?? false}
          busy={sale.isPending}
          initialNote={draft.note ?? ""}
          onConfirm={confirm}
        />
      )}
      <ReceiptDialog
        target={receipt}
        header={{
          businessName: tenantSettings?.name ?? active?.tenant.name ?? "",
          legalName: tenantSettings?.legal_name,
          taxId: tenantSettings?.tax_id,
          address: tenantSettings?.address,
          phone: tenantSettings?.phone,
          footer: tenantSettings?.receipt_footer,
          locationName: location?.name,
          locationAddress: location?.address,
          locationPhone: location?.phone,
          registerName: register?.name,
        }}
        onClose={() => {
          setReceipt(null);
          searchRef.current?.focus();
        }}
      />
      {holding && (
        <HoldDialog
          open
          onOpenChange={setHolding}
          defaultLabel=""
          busy={hold.isPending}
          onConfirm={(label) =>
            hold.mutate(
              { label, payload: draft, items: draft.lines.length, total: totals.total },
              {
                onSuccess: () => {
                  toast.success(`Carrito de ${label} en espera`);
                  setHolding(false);
                  setDraft(EMPTY_DRAFT);
                  setHits([]);
                  searchRef.current?.focus();
                },
                onError: notifyHoldError,
              },
            )
          }
        />
      )}
      <HeldListDialog
        open={heldOpen}
        onOpenChange={setHeldOpen}
        carts={held.data ?? []}
        currency={base}
        busy={resume.isPending}
        cartHasLines={draft.lines.length > 0}
        onResume={(c) =>
          resume.mutate(c.id, {
            onSuccess: (payload) => {
              setDraft({ ...EMPTY_DRAFT, ...payload });
              setHeldOpen(false);
              toast.success(`Retomado el carrito de ${c.label}`);
            },
            onError: notifyHoldError,
          })
        }
      />
      <SalesSheet
        open={history}
        onOpenChange={setHistory}
        sessionId={session.id}
        sessionOpen={session.status === "open"}
        methods={methods}
        onReprint={(saleId) => {
          setHistory(false);
          setReceipt({ saleId });
        }}
      />
      <CashMovementDialog sessionId={session.id} currencies={currencies} open={moving} onOpenChange={setMoving} />
      <CloseSessionDialog
        sessionId={session.id}
        baseCurrency={base}
        pendingSales={offline.queue.filter((q) => q.sessionId === session.id).length}
        open={closing}
        onOpenChange={setClosing}
        onClosed={() => {
          setClosing(false);
          writeStorage(draftKey, null);
          onLeave();
        }}
      />
    </div>
  );
}

function CartRow({
  line,
  total,
  currency,
  money,
  pricesIncludeTax,
  onQty,
  onDiscount,
  onRemove,
}: {
  line: CartLine;
  total: number;
  currency: string;
  money: MoneySettings | null;
  pricesIncludeTax: boolean;
  onQty: (qty: number) => void;
  onDiscount: (value: number) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [discountMode, setDiscountMode] = useState<"amount" | "percent">("amount");
  const applyDiscount = (text: string) => onDiscount(lineDiscountAmount(discountMode, parseAmount(text), line));
  const unit = shelfPrice(line.price, line.taxRate, pricesIncludeTax);
  const unitLocal = money?.localCurrency && money.rate ? fromBase(unit, money.localCurrency, money) : null;
  const unitLabel = unitLocal !== null && money?.localCurrency ? `${formatMoney(unitLocal, money.localCurrency)} (${formatMoney(unit, currency)})` : formatMoney(unit, currency);
  const atMax = line.available !== null && line.qty >= line.available;
  return (
    <li className="space-y-2 rounded-lg border p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{line.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[Object.values(line.options).join(" · "), line.sku, `${unitLabel} c/u`].filter(Boolean).join(" · ")}
          </p>
        </div>
        <button type="button" onClick={onRemove} aria-label={`Quitar ${line.name}`} className="text-muted-foreground hover:text-destructive">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="outline" className="h-9 w-9" aria-label="Menos" onClick={() => onQty(line.qty - 1)}>
            <Minus className="h-4 w-4" />
          </Button>
          {/* Se aplica al salir del campo: borrar para reescribir no quita la línea. */}
          <Input
            key={line.qty}
            inputMode="decimal"
            aria-label={`Cantidad de ${line.name}`}
            defaultValue={formatQty(line.qty)}
            onBlur={(e) => {
              const qty = parseAmount(e.target.value);
              if (qty > 0) onQty(qty);
              else e.target.value = formatQty(line.qty);
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className="num h-9 w-16 text-center"
          />
          <Button size="icon" variant="outline" className="h-9 w-9" aria-label="Más" disabled={atMax} onClick={() => onQty(line.qty + 1)}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <button type="button" className="text-xs text-primary underline" onClick={() => setEditing(!editing)}>
          {line.discount > 0 ? `−${formatMoney(line.discount, currency)}` : "Descuento"}
        </button>
        <DualPrice amount={total} baseCurrency={currency} money={money} size="sm" className="items-end text-right" />
      </div>
      {editing && (
        <div className="flex gap-1">
          <Input
            key={discountMode}
            inputMode="decimal"
            aria-label={`Descuento de ${line.name}`}
            defaultValue={discountMode === "amount" && line.discount > 0 ? String(line.discount) : ""}
            onBlur={(e) => applyDiscount(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                applyDiscount(e.currentTarget.value);
                setEditing(false);
              }
            }}
            placeholder={discountMode === "percent" ? "Porcentaje" : `Monto en ${currencySymbol(currency)}`}
            className="num h-9"
            autoFocus
          />
          {(["amount", "percent"] as const).map((m) => (
            <Button
              key={m}
              type="button"
              size="sm"
              className="h-9"
              variant={discountMode === m ? "default" : "outline"}
              aria-pressed={discountMode === m}
              onClick={() => setDiscountMode(m)}
            >
              {m === "percent" ? "%" : currencySymbol(currency)}
            </Button>
          ))}
        </div>
      )}
    </li>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}

/**
 * Alto del carrito en pantallas anchas: llega justo al borde inferior de la
 * ventana, para que totales y Cobrar se vean sin desplazar la página.
 */
function useFitToViewport(ref: React.RefObject<HTMLElement | null>): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1024px)");
    const update = () => {
      const el = ref.current;
      if (!el || !wide.matches) return setHeight(null);
      const top = Math.max(el.getBoundingClientRect().top, 16);
      setHeight(Math.max(420, Math.round(window.innerHeight - top - 16)));
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, { passive: true });
    wide.addEventListener("change", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update);
      wide.removeEventListener("change", update);
    };
  }, [ref]);
  return height;
}

function HeaderField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="mono-cap text-[10px] text-muted-foreground">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}

/** Bs y REF en una sola línea, para subtotales. */
function DualInline({ amount, base, money }: { amount: number; base: string; money: MoneySettings | null }) {
  const local = money?.localCurrency && money.rate ? fromBase(amount, money.localCurrency, money) : null;
  if (local === null || !money?.localCurrency) return <>{formatMoney(amount, base)}</>;
  return (
    <>
      {formatMoney(local, money.localCurrency)} <span className="text-[11px] text-muted-foreground">· {formatMoney(amount, base)}</span>
    </>
  );
}

function NoteDialog({
  open,
  onOpenChange,
  value,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onSave: (note: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => {
    if (open) setText(value);
  }, [open, value]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nota del pedido</DialogTitle>
        </DialogHeader>
        <Textarea
          aria-label="Nota del pedido"
          value={text}
          maxLength={500}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ej.: entregar mañana, el cliente retira en tienda…"
          autoFocus
        />
        <DialogFooter>
          {value && (
            <Button
              variant="ghost"
              onClick={() => {
                onSave("");
                onOpenChange(false);
              }}
            >
              Quitar nota
            </Button>
          )}
          <Button
            onClick={() => {
              onSave(text.trim());
              onOpenChange(false);
            }}
          >
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
