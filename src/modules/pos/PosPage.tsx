/**
 * Punto de venta. Portado de src/pages/pos/SublimePosApp.tsx, PosCatalog.tsx
 * y PosCart.tsx (basicosystems@f551478b): búsqueda por lector, código o texto;
 * carrito con descuentos; cobro mixto y nota de entrega. El total que vale es
 * el que calcula register_sale en el servidor.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Minus, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTenant } from "@/core/tenant-context";
import { cn } from "@/lib/utils";
import { useLocations } from "@/modules/inventory/api";
import { usePaymentMethods } from "@/modules/settings/api";
import {
  newIdempotencyKey,
  searchForPos,
  useOpenSessions,
  useRegisterSale,
  useRegisters,
  type CashSession,
  type PosHit,
} from "./api";
import {
  addToCart,
  cartDiscountAmount,
  cartTotals,
  formatMoney,
  formatQty,
  fromBase,
  removeLine,
  round2,
  setLineDiscount,
  setQty,
  type CartLine,
} from "./cart";
import { CashMovementDialog, CloseSessionDialog } from "./CashDialogs";
import OpenSessionScreen from "./OpenSessionScreen";
import PaymentDialog, { type PaymentResult } from "./PaymentDialog";
import ReceiptDialog from "./ReceiptDialog";
import { useScanner } from "./useScanner";
import { parseAmount, usePosMoney } from "./usePosMoney";

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
}

const EMPTY_DRAFT: CartDraft = { lines: [], discountMode: "amount", discountValue: "" };

function Terminal({ session, onLeave }: { session: CashSession; onLeave: () => void }) {
  const { active } = useTenant();
  const { money, stale, currencies, pricesIncludeTax } = usePosMoney();
  const { data: methods = [] } = usePaymentMethods();
  const { data: registers = [] } = useRegisters();
  const { data: locations = [] } = useLocations();
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
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const sale = useRegisterSale();

  const afterLineDiscounts = round2(draft.lines.reduce((a, l) => a + round2(l.price * l.qty) - l.discount, 0));
  const cartDiscount = cartDiscountAmount(draft.discountMode, parseAmount(draft.discountValue), afterLineDiscounts);
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
        const found = await searchForPos(q, session.location_id);
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
    [add, session.location_id],
  );

  // Búsqueda mientras se escribe, con pausa para no consultar en cada tecla.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const t = setTimeout(() => runSearch(q, false), 300);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  useScanner((code) => runSearch(code, true), !paying && !moving && !closing && !receiptId);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    runSearch(query, true);
  };

  const openPayment = () => {
    if (!money) return;
    if (draft.lines.length === 0) return toast.error("El carrito está vacío");
    if (totals.total <= 0) return toast.error("El total debe ser mayor que cero");
    idempotencyKey.current = newIdempotencyKey();
    setPaying(true);
  };

  const confirm = (result: PaymentResult) => {
    const key = idempotencyKey.current ?? newIdempotencyKey();
    idempotencyKey.current = key;
    sale.mutate(
      {
        idempotencyKey: key,
        sessionId: session.id,
        items: draft.lines.map((l) => ({ variant_id: l.variantId, qty: l.qty, discount: l.discount })),
        payments: result.payments.map((p) => ({ payment_method_id: p.methodId, amount: p.amount, reference: p.reference, bank: p.bank, extra: p.extra })),
        cartDiscount: totals.cartDiscount,
        change: result.change,
        customer: result.customer,
        note: result.note,
      },
      {
        onSuccess: (res) => {
          if (Math.abs(res.total - totals.total) >= 0.01) {
            toast.warning(`El servidor calculó ${formatMoney(res.total, money!.baseCurrency)}`);
          }
          idempotencyKey.current = null;
          setPaying(false);
          setDraft(EMPTY_DRAFT);
          setHits([]);
          setReceiptId(res.sale_id);
        },
        onError: (err) => toast.error("No se registró la venta", { description: err.message }),
      },
    );
  };

  const base = money?.baseCurrency ?? active?.tenant.base_currency ?? "USD";
  const localTotal = money?.localCurrency ? fromBase(totals.total, money.localCurrency, money) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3">
        <div className="text-sm">
          <p className="font-semibold">
            {register?.name ?? "Caja"} · <span className="mono">{session.number}</span>
          </p>
          <p className="text-xs text-muted-foreground">{location?.name}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setMoving(true)}>
            Efectivo
          </Button>
          <Button size="sm" variant="outline" onClick={() => setClosing(true)}>
            Cerrar caja
          </Button>
          <Button size="sm" variant="ghost" onClick={onLeave}>
            Cambiar caja
          </Button>
        </div>
      </div>

      {stale && (
        <p role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">
          La tasa no está al día. Actualízala en Configuración antes de cobrar en bolívares.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
        <section className="space-y-3" aria-label="Catálogo">
          <form onSubmit={submitSearch} className="relative">
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
          </form>
          {searching && <p className="mono-cap text-xs text-muted-foreground">Buscando…</p>}
          <ul className="grid gap-2 sm:grid-cols-2">
            {hits.map((h) => (
              <li key={h.variant_id}>
                <button
                  type="button"
                  onClick={() => {
                    add(h);
                    searchRef.current?.focus();
                  }}
                  disabled={h.available <= 0}
                  className="w-full rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary disabled:opacity-50"
                >
                  <p className="font-semibold">{h.product_name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[Object.values(h.options ?? {}).join(" · "), h.brand, h.sku].filter(Boolean).join(" · ")}
                  </p>
                  <div className="mt-1 flex items-baseline justify-between">
                    <span className="num font-bold">{h.price === null ? "Sin precio" : formatMoney(Number(h.price), base)}</span>
                    <span className={cn("num text-xs", h.available <= 0 ? "text-destructive" : "text-muted-foreground")}>
                      {formatQty(h.available)} {h.unit}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-3 rounded-xl border bg-card p-3 lg:sticky lg:top-4 lg:self-start" aria-label="Carrito">
          <div className="flex items-center justify-between">
            <h2 className="text-base">Carrito</h2>
            {draft.lines.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setDraft(EMPTY_DRAFT)}>
                Vaciar
              </Button>
            )}
          </div>
          {draft.lines.length === 0 && <p className="text-sm text-muted-foreground">Escanea o busca un producto para empezar.</p>}
          <ul className="space-y-2">
            {draft.lines.map((l) => (
              <CartRow
                key={l.variantId}
                line={l}
                total={totals.lines.find((t) => t.variantId === l.variantId)?.total ?? 0}
                currency={base}
                onQty={(qty) => setDraft((d) => ({ ...d, lines: setQty(d.lines, l.variantId, qty) }))}
                onDiscount={(v) => setDraft((d) => ({ ...d, lines: setLineDiscount(d.lines, l.variantId, v) }))}
                onRemove={() => setDraft((d) => ({ ...d, lines: removeLine(d.lines, l.variantId) }))}
              />
            ))}
          </ul>

          {draft.lines.length > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <span className="shrink-0">Descuento</span>
              <Input
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
                    {m === "amount" ? base : "%"}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <dl className="space-y-1 border-t pt-3 text-sm">
            <Row label="Subtotal" value={formatMoney(totals.subtotal, base)} />
            {totals.discount > 0 && <Row label="Descuentos" value={`−${formatMoney(totals.discount, base)}`} />}
            <Row label={pricesIncludeTax ? "Impuesto incluido" : "Impuesto"} value={formatMoney(totals.tax, base)} />
            <div className="flex items-baseline justify-between pt-1">
              <dt className="font-bold">Total</dt>
              <dd className="num text-2xl font-bold">{formatMoney(totals.total, base)}</dd>
            </div>
            {localTotal !== null && money?.localCurrency && (
              <Row label="Equivale" value={formatMoney(localTotal, money.localCurrency)} />
            )}
          </dl>
          <Button size="lg" className="h-14 w-full text-base" disabled={draft.lines.length === 0 || !money} onClick={openPayment}>
            Cobrar {draft.lines.length > 0 ? formatMoney(totals.total, base) : ""}
          </Button>
        </section>
      </div>

      {money && (
        <PaymentDialog open={paying} onOpenChange={setPaying} total={totals.total} money={money} methods={methods} busy={sale.isPending} onConfirm={confirm} />
      )}
      <ReceiptDialog
        saleId={receiptId}
        header={{ businessName: active?.tenant.name ?? "", locationName: location?.name, registerName: register?.name }}
        onClose={() => {
          setReceiptId(null);
          searchRef.current?.focus();
        }}
      />
      <CashMovementDialog sessionId={session.id} currencies={currencies} open={moving} onOpenChange={setMoving} />
      <CloseSessionDialog
        sessionId={session.id}
        baseCurrency={base}
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
  onQty,
  onDiscount,
  onRemove,
}: {
  line: CartLine;
  total: number;
  currency: string;
  onQty: (qty: number) => void;
  onDiscount: (value: number) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const atMax = line.available !== null && line.qty >= line.available;
  return (
    <li className="space-y-2 rounded-lg border p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{line.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[Object.values(line.options).join(" · "), line.sku, `${formatMoney(line.price, currency)} c/u`].filter(Boolean).join(" · ")}
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
        <span className="num font-semibold">{formatMoney(total, currency)}</span>
      </div>
      {editing && (
        <Input
          inputMode="decimal"
          aria-label={`Descuento de ${line.name}`}
          defaultValue={line.discount > 0 ? String(line.discount) : ""}
          onBlur={(e) => onDiscount(parseAmount(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onDiscount(parseAmount(e.currentTarget.value));
              setEditing(false);
            }
          }}
          placeholder={`Monto en ${currency}`}
          className="num h-9"
          autoFocus
        />
      )}
    </li>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}
