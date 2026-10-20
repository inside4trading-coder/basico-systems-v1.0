/**
 * Control de inventario: entradas, ajustes con firma, traslados, historial y
 * reportes de mermas. Portado de SublimeControlInventario.tsx
 * (basicosystems@f551478b). Cambios: sin etiquetas ni lotes ni evidencia
 * (fuera de v1), sede por defecto en vez de un id fijo, traslados aquí,
 * firma restringida a dueño/administrador distinto de quien ajustó, y
 * cantidades fraccionarias.
 */
import CountsTab from "./CountsTab";
import RestockTab from "./RestockTab";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, ClipboardCheck, PenLine, ScanLine, Undo2 } from "lucide-react";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/core/auth";
import { useTenant } from "@/core/tenant-context";
import { canEditCatalog, canSupervise } from "@/core/tenant-selection";
import { registerEntry, useAdjust, useInvalidateInventory, useMovements, useSign, useStockOf, useTransfer } from "./api";
import { LocationSelect, useDefaultLocation, VariantCard, VariantFinder } from "./components";
import {
  ADJUST_REASONS,
  formatDateTime,
  formatMoney,
  formatQty,
  MOVEMENT_KIND_LABEL,
  periodStart,
  variantLabel,
  type LookupResult,
  type MovementRow,
} from "./lib";

function toQty(text: string): number {
  const n = Number(text.trim().replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

function useCurrency() {
  const { active } = useTenant();
  return active?.tenant.base_currency ?? "USD";
}

/* ---------------- Entrada rápida (por lista) ---------------- */

type FastLine = { item: LookupResult; qty: string };

function QuickEntry() {
  const [loc, setLoc] = useDefaultLocation();
  const [item, setItem] = useState<LookupResult | null>(null);
  const [qty, setQty] = useState("1");
  const [batch, setBatch] = useState<FastLine[]>([]);
  const [busy, setBusy] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const invalidate = useInvalidateInventory();

  // Deja el cursor listo para la pistola.
  useEffect(() => {
    const t = setTimeout(() => scanRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, []);
  const refocus = () => setTimeout(() => scanRef.current?.focus(), 50);

  const n = toQty(qty);
  const valid = n > 0;

  const addToBatch = () => {
    if (!item || !valid) return;
    setBatch((b) => {
      const i = b.findIndex((l) => l.item.variant_id === item.variant_id);
      if (i >= 0) {
        toast.info("Ya estaba en la lista: se sumaron las cantidades");
        return b.map((l, j) => (j === i ? { ...l, qty: String(toQty(l.qty) + n) } : l));
      }
      return [...b, { item, qty: String(n) }];
    });
    setItem(null);
    setQty("1");
    refocus();
  };

  const confirmBatch = async () => {
    const lines = batch.filter((l) => toQty(l.qty) > 0);
    if (!lines.length) return toast.error("La lista está vacía");
    if (!loc) return toast.error("Elige la sede");
    setBusy(true);
    let done = 0;
    try {
      for (const l of lines) {
        await registerEntry({ variantId: l.item.variant_id, locationId: loc, qty: toQty(l.qty) });
        done++;
      }
      toast.success(`Entrada registrada: ${lines.length} producto(s)`);
      setBatch([]);
    } catch (err) {
      toast.error("La entrada se detuvo", {
        description: `${(err as Error).message}. Quedaron registrados ${done} de ${lines.length}; revisa el Historial.`,
      });
      setBatch((b) => b.slice(done));
    } finally {
      invalidate();
      setBusy(false);
      refocus();
    }
  };

  const totalUnits = batch.reduce((a, l) => a + (toQty(l.qty) || 0), 0);

  return (
    <div className="space-y-3">
      <LocationSelect value={loc} onChange={setLoc} />
      <VariantFinder onPick={setItem} autoFocus inputRef={scanRef} />
      {item && (
        <>
          <VariantCard item={item} locationId={loc} />
          <Label htmlFor="qe-qty">Cantidad a ingresar ({item.unit})</Label>
          <Input
            id="qe-qty"
            inputMode="decimal"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="h-12 text-lg"
            onKeyDown={(e) => {
              if (e.key === "Enter" && valid) addToBatch();
            }}
          />
          <Button className="h-12 w-full font-bold" disabled={!valid} onClick={addToBatch}>
            Agregar a la lista
          </Button>
        </>
      )}
      {batch.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold">Lista de entrada</p>
            <Badge variant="secondary">
              {batch.length} producto(s) · {formatQty(totalUnits)}
            </Badge>
          </div>
          {batch.map((l, i) => (
            <Card key={l.item.variant_id} className="flex items-center gap-2 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{l.item.product_name}</p>
                <p className="text-xs text-muted-foreground">{[variantLabel(l.item.options), l.item.sku].filter(Boolean).join(" · ") || "—"}</p>
              </div>
              <Input
                inputMode="decimal"
                value={l.qty}
                onChange={(e) => setBatch((b) => b.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
                className="h-10 w-20 text-center"
                aria-label="Cantidad"
              />
              <Button size="sm" variant="ghost" onClick={() => setBatch((b) => b.filter((_, j) => j !== i))}>
                Quitar
              </Button>
            </Card>
          ))}
          <Button className="h-14 w-full font-bold" disabled={busy} onClick={confirmBatch}>
            Confirmar entrada ({batch.length})
          </Button>
        </>
      )}
    </div>
  );
}

/* ---------------- Recepción detallada (esperado vs recibido, costo, proveedor) ---------------- */

type ReceptionLine = { item: LookupResult; expected: string; received: string; cost: string };

function Reception() {
  const currency = useCurrency();
  const [loc, setLoc] = useDefaultLocation();
  const [supplier, setSupplier] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<ReceptionLine[]>([]);
  const [busy, setBusy] = useState(false);
  const invalidate = useInvalidateInventory();

  const add = (found: LookupResult | null) => {
    if (!found) return;
    if (lines.some((l) => l.item.variant_id === found.variant_id)) return toast.info("Ese producto ya está en la lista");
    setLines((ls) => [...ls, { item: found, expected: "", received: "1", cost: found.cost != null ? String(found.cost) : "" }]);
  };
  const upd = (i: number, patch: Partial<ReceptionLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const confirm = async () => {
    const valid = lines.filter((l) => toQty(l.received) > 0);
    if (!valid.length) return toast.error("Indica al menos una cantidad recibida");
    if (!loc) return toast.error("Elige la sede");
    setBusy(true);
    let done = 0;
    try {
      for (const l of valid) {
        await registerEntry({
          variantId: l.item.variant_id,
          locationId: loc,
          qty: toQty(l.received),
          unitCost: l.cost.trim() === "" ? null : toQty(l.cost),
          supplier: supplier || null,
          note: note || null,
          expectedQty: l.expected.trim() === "" ? null : toQty(l.expected),
        });
        done++;
      }
      toast.success(`Recepción registrada: ${valid.length} producto(s)`);
      setLines([]);
      setNote("");
    } catch (err) {
      toast.error("La recepción se detuvo", {
        description: `${(err as Error).message}. Quedaron registrados ${done} de ${valid.length}; revisa el Historial.`,
      });
      setLines((ls) => ls.filter((l) => !valid.slice(0, done).includes(l)));
    } finally {
      invalidate();
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <LocationSelect value={loc} onChange={setLoc} />
      <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Proveedor" className="h-11" aria-label="Proveedor" />
      <VariantFinder onPick={add} />
      {lines.map((l, i) => {
        const diff = l.expected.trim() !== "" && toQty(l.expected) !== toQty(l.received);
        return (
          <Card key={l.item.variant_id} className="space-y-2 p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-bold">{l.item.product_name}</p>
                <p className="text-xs text-muted-foreground">{[variantLabel(l.item.options), l.item.sku].filter(Boolean).join(" · ") || "—"}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                Quitar
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-[11px]">Esperada</Label>
                <Input inputMode="decimal" value={l.expected} onChange={(e) => upd(i, { expected: e.target.value })} />
              </div>
              <div>
                <Label className="text-[11px]">Recibida</Label>
                <Input inputMode="decimal" value={l.received} onChange={(e) => upd(i, { received: e.target.value })} />
              </div>
              <div>
                <Label className="text-[11px]">Costo ({currency})</Label>
                <Input inputMode="decimal" value={l.cost} onChange={(e) => upd(i, { cost: e.target.value })} />
              </div>
            </div>
            {diff && (
              <p className="text-xs font-semibold text-status-warning">
                Diferencia: esperada {l.expected}, recibida {l.received}
              </p>
            )}
          </Card>
        );
      })}
      <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notas" aria-label="Notas" />
      <Button className="h-14 w-full font-bold" disabled={busy || !lines.length} onClick={confirm}>
        Confirmar recepción
      </Button>
    </div>
  );
}

/* ---------------- Ajustes ---------------- */

function Adjustments() {
  const [loc, setLoc] = useDefaultLocation();
  const [item, setItem] = useState<LookupResult | null>(null);
  const [sign, setSign] = useState<"-" | "+">("-");
  const [qty, setQty] = useState("1");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const { data: stock } = useStockOf(item?.variant_id ?? null, loc);
  const adjust = useAdjust();
  const n = toQty(qty);
  const delta = (sign === "-" ? -1 : 1) * (n || 0);
  const after = stock ? stock.here + delta : null;

  const submit = () =>
    adjust.mutate(
      { variantId: item!.variant_id, locationId: loc, delta, reason, note: note || null },
      {
        onSuccess: (d) => {
          toast.success(`Ajuste aplicado: ${formatQty(d.before)} → ${formatQty(d.after)}`, { description: "Pendiente de firma" });
          setItem(null);
          setQty("1");
          setReason("");
          setNote("");
        },
        onError: (err) => toast.error("No se pudo ajustar", { description: err.message }),
      },
    );

  return (
    <div className="space-y-3">
      <LocationSelect value={loc} onChange={setLoc} />
      <VariantFinder onPick={setItem} />
      {item && (
        <>
          <VariantCard item={item} locationId={loc} />
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <div className="flex overflow-hidden rounded-md border">
              <Button type="button" variant={sign === "-" ? "default" : "ghost"} className="h-12 w-12 rounded-none text-lg" onClick={() => setSign("-")} aria-label="Restar">
                −
              </Button>
              <Button type="button" variant={sign === "+" ? "default" : "ghost"} className="h-12 w-12 rounded-none text-lg" onClick={() => setSign("+")} aria-label="Sumar">
                +
              </Button>
            </div>
            <Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} className="h-12 text-lg" aria-label="Cantidad" />
          </div>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger className="h-11" aria-label="Motivo">
              <SelectValue placeholder="Motivo (obligatorio)" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(ADJUST_REASONS)
                .filter(([k]) => k !== "correccion")
                .map(([k, l]) => (
                  <SelectItem key={k} value={k}>
                    {l}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota (opcional)" aria-label="Nota" />
          {after != null && n > 0 && (
            <p className="text-sm">
              Quedarán <b className="text-lg">{formatQty(Math.max(after, 0))}</b>{" "}
              <span className="text-muted-foreground">
                (antes {formatQty(stock!.here)}, se {delta < 0 ? "resta" : "suma"} {formatQty(Math.abs(delta))})
              </span>
            </p>
          )}
          <Button className="h-14 w-full font-bold" disabled={!reason || !(n > 0) || adjust.isPending || after == null || after < 0} onClick={submit}>
            Confirmar ajuste
          </Button>
          <p className="text-xs text-muted-foreground">El stock cambia al instante. El ajuste queda pendiente de firma de un dueño o administrador.</p>
        </>
      )}
    </div>
  );
}

/* ---------------- Traslados ---------------- */

function Transfers() {
  const [from, setFrom] = useDefaultLocation();
  const [to, setTo] = useState("");
  const [item, setItem] = useState<LookupResult | null>(null);
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");
  const transfer = useTransfer();
  const n = toQty(qty);

  const submit = () =>
    transfer.mutate(
      { variantId: item!.variant_id, from, to, qty: n, note: note || null },
      {
        onSuccess: (d) => {
          toast.success("Traslado registrado", { description: `Origen queda en ${formatQty(d.from_after)}, destino en ${formatQty(d.to_after)}` });
          setItem(null);
          setQty("1");
          setNote("");
        },
        onError: (err) => toast.error("No se pudo trasladar", { description: err.message }),
      },
    );

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Desde</Label>
          <LocationSelect value={from} onChange={setFrom} placeholder="Origen" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Hacia</Label>
          <LocationSelect value={to} onChange={setTo} placeholder="Destino" exclude={from} />
        </div>
      </div>
      <VariantFinder onPick={setItem} />
      {item && (
        <>
          <VariantCard item={item} locationId={from} />
          <Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} className="h-12 text-lg" aria-label="Cantidad a trasladar" />
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota (opcional)" aria-label="Nota" />
          <Button className="h-14 w-full font-bold" disabled={!to || !(n > 0) || transfer.isPending} onClick={submit}>
            <ArrowLeftRight /> Confirmar traslado
          </Button>
        </>
      )}
    </div>
  );
}

/* ---------------- Tarjeta de movimiento ---------------- */

function SignatureBadge({ status }: { status: MovementRow["signature_status"] }) {
  if (status === "pending") return <Badge variant="outline" className="border-status-warning/40 bg-status-warning/10">Pendiente de firma</Badge>;
  if (status === "signed") return <Badge variant="outline" className="border-status-success/30 bg-status-success/10 text-status-success">Firmado</Badge>;
  return null;
}

function MovementCard({ m, actions }: { m: MovementRow; actions?: React.ReactNode }) {
  const currency = useCurrency();
  const abs = Math.abs(Number(m.qty_delta));
  const detail = [m.brand, variantLabel(m.options), m.sku].filter(Boolean).join(" · ");
  return (
    <Card className="space-y-1 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">{m.product_name}</p>
          {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
        </div>
        <span className={`num shrink-0 text-lg font-bold ${m.qty_delta < 0 ? "text-destructive" : "text-status-success"}`}>
          {m.qty_delta > 0 ? "+" : ""}
          {formatQty(m.qty_delta)}
        </span>
      </div>
      <p className="text-xs">
        Stock {formatQty(m.qty_before)} → <b>{formatQty(m.qty_after)}</b> · {m.location_name}
      </p>
      <p className="text-xs text-muted-foreground">
        {MOVEMENT_KIND_LABEL[m.kind]}
        {m.reason ? ` · ${ADJUST_REASONS[m.reason] ?? m.reason}` : ""} · {m.performed_by_email ?? "—"} · {formatDateTime(m.created_at)}
      </p>
      <p className="text-xs text-muted-foreground">
        Costo {formatMoney(abs * Number(m.unit_cost ?? 0), currency)} · Venta {formatMoney(abs * Number(m.unit_price ?? 0), currency)}
        {m.supplier ? ` · ${m.supplier}` : ""}
        {m.expected_qty != null && Number(m.expected_qty) !== Number(m.qty_delta) ? ` · esperada ${formatQty(m.expected_qty)}` : ""}
      </p>
      {m.note && <p className="text-xs">Nota: {m.note}</p>}
      {m.corrects_movement_id && <p className="text-xs font-semibold">Corrige un ajuste anterior</p>}
      {m.signature_status === "signed" && (
        <p className="text-xs text-muted-foreground">
          Firmado por {m.signed_by_email ?? "—"}
          {m.signed_at ? ` · ${formatDateTime(m.signed_at)}` : ""}
          {m.signature_note ? ` · "${m.signature_note}"` : ""}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <SignatureBadge status={m.signature_status} />
        {actions}
      </div>
    </Card>
  );
}

/* ---------------- Pendientes de firma ---------------- */

function PendingSignatures({ rows }: { rows: MovementRow[] }) {
  const { active } = useTenant();
  const { session } = useAuth();
  const canSign = canSupervise(active?.role);
  const canCorrect = canEditCatalog(active?.role);
  const sign = useSign();
  const adjust = useAdjust();
  const [signing, setSigning] = useState<MovementRow | null>(null);
  const [obs, setObs] = useState("");
  const pending = rows.filter((r) => r.signature_status === "pending");
  const correctedIds = new Set(rows.map((r) => r.corrects_movement_id).filter(Boolean));

  const doSign = () =>
    sign.mutate(
      { movementId: signing!.id, note: obs || null },
      {
        onSuccess: () => {
          toast.success("Ajuste firmado");
          setSigning(null);
          setObs("");
        },
        onError: (err) => toast.error("No se pudo firmar", { description: err.message }),
      },
    );

  const correct = (m: MovementRow) => {
    if (!window.confirm(`Se creará un movimiento contrario (${m.qty_delta > 0 ? "" : "+"}${formatQty(-m.qty_delta)}). El original no se borra. ¿Continuar?`)) return;
    adjust.mutate(
      { variantId: m.variant_id, locationId: m.location_id, delta: -m.qty_delta, reason: "correccion", note: `Corrige ajuste del ${formatDateTime(m.created_at)}`, correctsId: m.id },
      {
        onSuccess: () => toast.success("Corrección registrada", { description: "También queda pendiente de firma" }),
        onError: (err) => toast.error("No se pudo corregir", { description: err.message }),
      },
    );
  };

  return (
    <div className="space-y-3">
      {!canSign && <Card className="p-3 text-sm text-muted-foreground">Solo un dueño o administrador puede firmar.</Card>}
      {pending.length === 0 && <Card className="p-6 text-center text-sm text-muted-foreground">No hay ajustes pendientes de firma.</Card>}
      {pending.map((m) => {
        const own = m.performed_by === session?.user.id;
        return (
          <MovementCard
            key={m.id}
            m={m}
            actions={
              <>
                {canSign && !own && (
                  <Button size="sm" onClick={() => setSigning(m)}>
                    <PenLine /> Revisar y firmar
                  </Button>
                )}
                {canSign && own && <span className="text-xs text-muted-foreground">Lo firma otra persona</span>}
                {canCorrect && !m.corrects_movement_id && !correctedIds.has(m.id) && (
                  <Button size="sm" variant="outline" onClick={() => correct(m)}>
                    <Undo2 /> Corregir
                  </Button>
                )}
                {correctedIds.has(m.id) && <Badge variant="secondary">Ya corregido</Badge>}
              </>
            }
          />
        );
      })}
      <Dialog open={!!signing} onOpenChange={(o) => !o && setSigning(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Firmar ajuste</DialogTitle>
          </DialogHeader>
          {signing && <MovementCard m={signing} />}
          <Textarea value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observación (opcional)" aria-label="Observación" />
          <DialogFooter>
            <Button disabled={sign.isPending} onClick={doSign}>
              Firmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------------- Historial ---------------- */

function History({ rows }: { rows: MovementRow[] }) {
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [kind, setKind] = useState("all");
  const [sig, setSig] = useState("all");
  const [loc, setLoc] = useState("all");
  const [reason, setReason] = useState("all");
  const locs = useMemo(() => Array.from(new Map(rows.map((r) => [r.location_id, r.location_name])).entries()), [rows]);

  const visible = rows.filter((r) => {
    const d = r.created_at.slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (kind === "adj_pos" && !(r.kind === "adjustment" && r.qty_delta > 0)) return false;
    if (kind === "adj_neg" && !(r.kind === "adjustment" && r.qty_delta < 0)) return false;
    if (kind === "transfer" && !r.kind.startsWith("transfer")) return false;
    if (kind === "entry" && r.kind !== "entry") return false;
    if (sig !== "all" && r.signature_status !== sig) return false;
    if (loc !== "all" && r.location_id !== loc) return false;
    if (reason !== "all" && r.reason !== reason) return false;
    if (q) {
      const s = q.toLowerCase();
      if (![r.product_name, r.sku, r.brand].some((x) => (x ?? "").toLowerCase().includes(s))) return false;
    }
    return true;
  });

  return (
    <div className="space-y-3">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Producto, SKU o marca" className="h-11" aria-label="Buscar en el historial" />
      <div className="grid grid-cols-2 gap-2">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Desde" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Hasta" />
        <Filter value={kind} onChange={setKind} options={[["all", "Todos los tipos"], ["entry", "Entradas"], ["adj_pos", "Ajustes positivos"], ["adj_neg", "Ajustes negativos"], ["transfer", "Traslados"]]} />
        <Filter value={sig} onChange={setSig} options={[["all", "Firma: todas"], ["pending", "Pendiente"], ["signed", "Firmado"]]} />
        <Filter value={loc} onChange={setLoc} options={[["all", "Todas las sedes"], ...locs]} />
        <Filter value={reason} onChange={setReason} options={[["all", "Todos los motivos"], ...Object.entries(ADJUST_REASONS)]} />
      </div>
      <p className="text-xs text-muted-foreground">{visible.length} movimiento(s)</p>
      {visible.slice(0, 300).map((m) => (
        <MovementCard key={m.id} m={m} />
      ))}
      {visible.length > 300 && <p className="text-center text-xs text-muted-foreground">Mostrando 300 de {visible.length}. Usa los filtros para acotar.</p>}
    </div>
  );
}

function Filter({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([k, l]) => (
          <SelectItem key={k} value={k}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* ---------------- Reportes de mermas (ajustes negativos) ---------------- */

const GROUPS = {
  reason: { label: "motivo", key: (r: MovementRow) => ADJUST_REASONS[r.reason ?? ""] ?? r.reason ?? "—" },
  user: { label: "persona", key: (r: MovementRow) => r.performed_by_email ?? "—" },
  location: { label: "sede", key: (r: MovementRow) => r.location_name },
  product: { label: "producto", key: (r: MovementRow) => r.product_name },
  brand: { label: "marca", key: (r: MovementRow) => r.brand ?? "Sin marca" },
  category: { label: "categoría", key: (r: MovementRow) => r.category ?? "Sin categoría" },
};

function Reports({ rows }: { rows: MovementRow[] }) {
  const currency = useCurrency();
  const [period, setPeriod] = useState<"today" | "week" | "month" | "year" | "all">("month");
  const [by, setBy] = useState<keyof typeof GROUPS>("reason");
  const start = periodStart(period);
  const losses = rows.filter((r) => r.kind === "adjustment" && r.qty_delta < 0 && (!start || r.created_at >= start));
  const sum = (list: MovementRow[]) =>
    list.reduce(
      (a, r) => {
        const u = -Number(r.qty_delta);
        a.units += u;
        a.cost += u * Number(r.unit_cost ?? 0);
        a.price += u * Number(r.unit_price ?? 0);
        return a;
      },
      { units: 0, cost: 0, price: 0 },
    );
  const total = sum(losses);
  const groups = Array.from(
    losses.reduce((mp, r) => {
      const k = GROUPS[by].key(r);
      mp.set(k, [...(mp.get(k) ?? []), r]);
      return mp;
    }, new Map<string, MovementRow[]>()),
  )
    .map(([k, list]) => ({ k, ...sum(list) }))
    .sort((a, b) => b.cost - a.cost);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {(
          [
            ["today", "Hoy"],
            ["week", "Semana"],
            ["month", "Mes"],
            ["year", "Año"],
            ["all", "Todo"],
          ] as const
        ).map(([k, l]) => (
          <Button key={k} size="sm" variant={period === k ? "default" : "outline"} onClick={() => setPeriod(k)}>
            {l}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Card className="p-3">
          <p className="text-[11px] text-muted-foreground">Unidades</p>
          <p className="num text-lg font-bold">{formatQty(total.units)}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[11px] text-muted-foreground">A costo</p>
          <p className="num text-sm font-bold">{formatMoney(total.cost, currency)}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[11px] text-muted-foreground">A precio de venta</p>
          <p className="num text-sm font-bold">{formatMoney(total.price, currency)}</p>
        </Card>
      </div>
      <Select value={by} onValueChange={(v) => setBy(v as keyof typeof GROUPS)}>
        <SelectTrigger aria-label="Agrupar por">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(GROUPS).map(([k, g]) => (
            <SelectItem key={k} value={k}>
              Por {g.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {groups.length === 0 && <Card className="p-6 text-center text-sm text-muted-foreground">Sin mermas en este periodo.</Card>}
      {groups.map((g) => (
        <Card key={g.k} className="flex items-center justify-between gap-2 p-3">
          <p className="min-w-0 truncate text-sm font-bold">{g.k}</p>
          <p className="num shrink-0 text-right text-xs">
            {formatQty(g.units)} · {formatMoney(g.cost, currency)}
            <br />
            <span className="text-muted-foreground">venta {formatMoney(g.price, currency)}</span>
          </p>
        </Card>
      ))}
    </div>
  );
}

/* ---------------- Resumen ---------------- */

function Summary({ rows, go, editable }: { rows: MovementRow[]; go: (t: string) => void; editable: boolean }) {
  const today = new Date().toDateString();
  const t = rows.filter((r) => new Date(r.created_at).toDateString() === today);
  const entered = t.filter((r) => r.kind === "entry").reduce((a, r) => a + Number(r.qty_delta), 0);
  const adjustments = t.filter((r) => r.kind === "adjustment").length;
  const pending = rows.filter((r) => r.signature_status === "pending").length;
  const tiles: [string, string, string][] = [
    ["Unidades ingresadas hoy", formatQty(entered), "historial"],
    ["Ajustes hoy", String(adjustments), "historial"],
    ["Pendientes de firma", String(pending), "firmas"],
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {tiles.map(([label, value, tab]) => (
          <Card key={label} className="cursor-pointer p-3 hover:border-primary/40" onClick={() => go(tab)}>
            <p className="text-[11px] text-muted-foreground">{label}</p>
            <p className="num text-2xl font-bold">{value}</p>
          </Card>
        ))}
      </div>
      {editable && (
        <div className="grid grid-cols-2 gap-2">
          <Button className="h-14" onClick={() => go("entrada")}>
            <ScanLine /> Entrada rápida
          </Button>
          <Button variant="outline" className="h-14" onClick={() => go("ajustes")}>
            <ClipboardCheck /> Ajuste
          </Button>
        </div>
      )}
    </div>
  );
}

export default function ControlPage() {
  const { active } = useTenant();
  const editable = canEditCatalog(active?.role);
  const [tab, setTab] = useState("resumen");
  const { data: rows = [] } = useMovements();
  const pending = rows.filter((r) => r.signature_status === "pending").length;

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [tab]);

  return (
    <AppShell wide>
      <div>
        <h1 className="text-2xl">Control de inventario</h1>
        <p className="text-sm text-muted-foreground">Entradas, ajustes, traslados, firmas e historial</p>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList className="w-max">
            <TabsTrigger value="resumen">Resumen</TabsTrigger>
            {editable && <TabsTrigger value="entrada">Entrada rápida</TabsTrigger>}
            {editable && <TabsTrigger value="recepcion">Recepción</TabsTrigger>}
            {editable && <TabsTrigger value="ajustes">Ajustes</TabsTrigger>}
            {editable && <TabsTrigger value="traslados">Traslados</TabsTrigger>}
            {editable && <TabsTrigger value="reposicion">Reposición</TabsTrigger>}
            <TabsTrigger value="conteos">Conteos</TabsTrigger>
            <TabsTrigger value="firmas">Firmas{pending ? ` (${pending})` : ""}</TabsTrigger>
            <TabsTrigger value="historial">Historial</TabsTrigger>
            <TabsTrigger value="reportes">Mermas</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="resumen">
          <Summary rows={rows} go={setTab} editable={editable} />
        </TabsContent>
        {editable && (
          <>
            <TabsContent value="entrada">
              <QuickEntry />
            </TabsContent>
            <TabsContent value="recepcion">
              <Reception />
            </TabsContent>
            <TabsContent value="ajustes">
              <Adjustments />
            </TabsContent>
            <TabsContent value="traslados">
              <Transfers />
            </TabsContent>
            <TabsContent value="reposicion">
              <RestockTab />
            </TabsContent>
          </>
        )}
        <TabsContent value="conteos">
          <CountsTab />
        </TabsContent>
        <TabsContent value="firmas">
          <PendingSignatures rows={rows} />
        </TabsContent>
        <TabsContent value="historial">
          <History rows={rows} />
        </TabsContent>
        <TabsContent value="reportes">
          <Reports rows={rows} />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
