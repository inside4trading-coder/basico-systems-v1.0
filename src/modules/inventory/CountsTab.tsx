/**
 * Conteo físico: se abre por sede (todo o una categoría), se cuenta con el
 * lector o a mano y al cerrar las diferencias quedan como ajustes (Firmas,
 * Historial, Mermas). Ciego: mientras se cuenta no se muestra lo que dice el
 * sistema.
 */
import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ScanButton } from "@/core/scanner/CameraScanner";
import { useScanner } from "@/core/scanner/useScanner";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";
import { canEditCatalog } from "@/core/tenant-selection";
import { useLocations } from "./api";
import { formatDateTime, formatQty } from "./lib";

interface Count {
  id: string;
  number: string;
  location_id: string;
  category: string | null;
  blind: boolean;
  status: "open" | "closed" | "cancelled";
  note: string | null;
  created_at: string;
  closed_at: string | null;
  adjustments: number | null;
}

interface CountItem {
  id: string;
  variant_id: string;
  expected: number | null;
  counted: number | null;
  variants: { sku: string | null; options: Record<string, string>; products: { name: string } | null } | null;
}

const STATUS = { open: "Abierto", closed: "Cerrado", cancelled: "Anulado" } as const;

function useTenantKey() {
  return useTenant().active?.tenant.id ?? "none";
}

function useCounts() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["inv", tenant, "counts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("inventory_counts").select("*").order("created_at", { ascending: false }).limit(30);
      if (error) throw new Error(error.message);
      return (data ?? []) as Count[];
    },
  });
}

function useCountItems(countId: string | null) {
  const tenant = useTenantKey();
  return useQuery({
    enabled: Boolean(countId),
    queryKey: ["inv", tenant, "counts", countId, "items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_count_items")
        .select("id, variant_id, expected, counted, variants(sku, options, products(name))")
        .eq("count_id", countId);
      if (error) throw new Error(error.message);
      return ((data ?? []) as unknown as CountItem[])
        .map((i) => ({ ...i, expected: i.expected === null ? null : Number(i.expected), counted: i.counted === null ? null : Number(i.counted) }))
        .sort((a, b) => (a.variants?.products?.name ?? "").localeCompare(b.variants?.products?.name ?? ""));
    },
  });
}

function useSystemStock(locationId: string | null, enabled: boolean) {
  const tenant = useTenantKey();
  return useQuery({
    enabled: enabled && Boolean(locationId),
    queryKey: ["inv", tenant, "counts", "stock", locationId],
    queryFn: async () => {
      const { data, error } = await supabase.from("stocks").select("variant_id, on_hand").eq("location_id", locationId);
      if (error) throw new Error(error.message);
      return new Map((data ?? []).map((s) => [s.variant_id as string, Number(s.on_hand)]));
    },
  });
}

function useRpc<T extends Record<string, unknown>, R = unknown>(fn: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: T) => {
      const { data, error } = await supabase.rpc(fn, args);
      if (error) throw new Error(error.message);
      return data as R;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inv"] }),
  });
}

const itemName = (i: CountItem) =>
  [i.variants?.products?.name ?? "Producto", ...Object.values(i.variants?.options ?? {})].join(" · ");

export default function CountsTab() {
  const { active } = useTenant();
  const supervisor = canEditCatalog(active?.role);
  const { data: counts = [] } = useCounts();
  const { data: locations = [] } = useLocations();
  const [openId, setOpenId] = useState<string | null>(null);
  const start = useRpc<{ p_location_id: string; p_category: string | null; p_blind: boolean; p_note: string | null }, string>("start_inventory_count");
  const [locationId, setLocationId] = useState("");
  const [category, setCategory] = useState("");
  const [blind, setBlind] = useState(true);
  const locName = (id: string) => locations.find((l) => l.id === id)?.name ?? "";
  const current = counts.find((c) => c.id === openId) ?? null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!locationId) return toast.error("Elige la sede");
    start.mutate(
      { p_location_id: locationId, p_category: category.trim() || null, p_blind: blind, p_note: null },
      {
        onSuccess: (id) => {
          toast.success("Conteo abierto");
          setOpenId(id);
        },
        onError: (err) => toast.error("No se pudo abrir", { description: err.message }),
      },
    );
  };

  if (current) return <CountView count={current} locationName={locName(current.location_id)} supervisor={supervisor} onBack={() => setOpenId(null)} />;

  return (
    <div className="space-y-4">
      {supervisor && (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3">
          <div className="space-y-1">
            <Label htmlFor="ct-loc">Sede</Label>
            <select id="ct-loc" className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">Elegir…</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ct-cat">Categoría (opcional)</Label>
            <Input id="ct-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Todo el inventario" className="w-48" />
          </div>
          <label className="flex h-10 items-center gap-2 text-sm">
            <Switch checked={blind} onCheckedChange={setBlind} />
            Ciego
          </label>
          <Button type="submit" disabled={start.isPending}>
            Abrir conteo
          </Button>
        </form>
      )}
      <ul className="space-y-2">
        {counts.map((c) => (
          <li key={c.id}>
            <button type="button" className="flex w-full items-center justify-between gap-3 rounded-lg border bg-card p-3 text-left text-sm hover:border-primary/50" onClick={() => setOpenId(c.id)}>
              <span>
                <span className="font-semibold">{c.number}</span> · {locName(c.location_id)}
                {c.category ? ` · ${c.category}` : ""}
                <span className="block text-xs text-muted-foreground">
                  {formatDateTime(c.created_at)}
                  {c.status === "closed" && c.adjustments !== null ? ` · ${c.adjustments} ajuste${c.adjustments === 1 ? "" : "s"}` : ""}
                </span>
              </span>
              <Badge variant={c.status === "open" ? "default" : "secondary"}>{STATUS[c.status]}</Badge>
            </button>
          </li>
        ))}
        {counts.length === 0 && <li className="text-sm text-muted-foreground">Sin conteos todavía.</li>}
      </ul>
    </div>
  );
}

function CountView({ count, locationName, supervisor, onBack }: { count: Count; locationName: string; supervisor: boolean; onBack: () => void }) {
  const { data: items = [] } = useCountItems(count.id);
  const showSystem = !count.blind || count.status !== "open";
  const { data: system } = useSystemStock(count.location_id, showSystem && count.status === "open");
  const setQty = useRpc<{ p_count_id: string; p_variant_id: string; p_qty: number; p_add: boolean }, number>("count_inventory_item");
  const close = useRpc<{ p_count_id: string; p_missing_as_zero: boolean }, { adjustments: number; plus: number; minus: number }>("close_inventory_count");
  const cancel = useRpc<{ p_count_id: string }>("cancel_inventory_count");
  const [scan, setScan] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [missingAsZero, setMissingAsZero] = useState(false);
  const counted = items.filter((i) => i.counted !== null).length;
  const shown = useMemo(() => (onlyMissing ? items.filter((i) => i.counted === null) : items), [items, onlyMissing]);
  const open = count.status === "open";
  const fail = (title: string) => (err: Error) => toast.error(title, { description: err.message });

  const addOne = async (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    const { data, error } = await supabase.rpc("catalog_lookup", { p_query: q, p_limit: 2 });
    if (error) return toast.error(error.message);
    const hits = (data ?? []) as { variant_id: string; product_name: string; match_kind: string }[];
    if (hits.length !== 1) return toast.error(hits.length ? "Varias coincidencias: escribe el código completo" : "No se encontró");
    setQty.mutate(
      { p_count_id: count.id, p_variant_id: hits[0].variant_id, p_qty: 1, p_add: true },
      { onSuccess: (n) => toast.success(`${hits[0].product_name}: ${formatQty(n)}`), onError: fail("No se pudo contar") },
    );
    setScan("");
  };
  const onScan = (event: FormEvent) => {
    event.preventDefault();
    addOne(scan);
  };
  useScanner((code) => {
    setScan("");
    addOne(code);
  }, open);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold">
            {count.number} · {locationName}
            {count.category ? ` · ${count.category}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            {STATUS[count.status]} · {counted} de {items.length} contados{count.blind && open ? " · ciego" : ""}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          Volver
        </Button>
      </div>

      {open && (
        <form onSubmit={onScan} className="flex gap-2">
          <Input value={scan} onChange={(e) => setScan(e.target.value)} placeholder="Escanea o escribe el código: suma 1" aria-label="Escanear producto" autoFocus />
          <ScanButton onScan={addOne} />
          <Button type="submit" variant="outline">
            Sumar
          </Button>
        </form>
      )}
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Switch checked={onlyMissing} onCheckedChange={setOnlyMissing} />
        Solo sin contar
      </label>

      <ul className="divide-y rounded-xl border bg-card">
        {shown.map((i) => {
          const sys = count.status === "open" ? system?.get(i.variant_id) : i.expected;
          const diff = i.counted !== null && sys !== undefined && sys !== null ? i.counted - sys : null;
          return (
            <li key={i.id} className="flex flex-wrap items-center gap-3 p-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{itemName(i)}</span>
                <span className="block text-xs text-muted-foreground">
                  {i.variants?.sku ?? ""}
                  {showSystem && sys !== undefined && sys !== null ? ` · sistema ${formatQty(sys)}` : ""}
                  {showSystem && diff !== null && diff !== 0 ? ` · diferencia ${diff > 0 ? "+" : ""}${formatQty(diff)}` : ""}
                </span>
              </span>
              {open ? (
                <Input
                  key={`${i.id}-${i.counted}`}
                  className="num h-9 w-24 text-right"
                  inputMode="decimal"
                  aria-label={`Contado de ${itemName(i)}`}
                  defaultValue={i.counted === null ? "" : String(i.counted)}
                  placeholder="—"
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v === "" || Number(v.replace(",", ".")) === i.counted) return;
                    const n = Number(v.replace(",", "."));
                    if (!Number.isFinite(n) || n < 0) return toast.error("Cantidad inválida");
                    setQty.mutate({ p_count_id: count.id, p_variant_id: i.variant_id, p_qty: n, p_add: false }, { onError: fail("No se pudo guardar") });
                  }}
                />
              ) : (
                <span className="num w-24 text-right">{i.counted === null ? "—" : formatQty(i.counted)}</span>
              )}
            </li>
          );
        })}
        {shown.length === 0 && <li className="p-3 text-sm text-muted-foreground">Nada que mostrar.</li>}
      </ul>

      {open && supervisor && (
        <div className="space-y-2 rounded-xl border p-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={missingAsZero} onCheckedChange={setMissingAsZero} />
            Lo que no se contó, contarlo como cero
          </label>
          <p className="text-xs text-muted-foreground">
            Al cerrar se compara con lo que dice el sistema en ese momento y cada diferencia queda como ajuste pendiente de firma.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={close.isPending || counted === 0}
              onClick={() =>
                close.mutate(
                  { p_count_id: count.id, p_missing_as_zero: missingAsZero },
                  {
                    onSuccess: (r) =>
                      toast.success(`Conteo cerrado: ${r.adjustments} ajuste${r.adjustments === 1 ? "" : "s"}`, {
                        description: `+${formatQty(r.plus)} / −${formatQty(r.minus)} unidades`,
                      }),
                    onError: fail("No se pudo cerrar"),
                  },
                )
              }
            >
              Cerrar y ajustar
            </Button>
            <Button
              variant="outline"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate({ p_count_id: count.id }, { onSuccess: () => toast.success("Conteo anulado"), onError: fail("No se pudo anular") })}
            >
              Anular
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
