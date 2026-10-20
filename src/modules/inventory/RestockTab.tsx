/**
 * Qué reponer en cada sede: por mínimo (si se fijó) o por rotación (lo vendido
 * en los últimos días), con las sedes de donde sacarlo. Portado de
 * SublimeNecesidadReposicion (basicosystems@f551478b).
 */
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";
import { DataTable, ExportButton, Panel, type Column } from "@/modules/reports/components";
import { parseAmount } from "./import/preview";
import { useLocations } from "./api";
import { formatQty } from "./lib";

export interface RestockRow {
  variant_id: string;
  name: string;
  sku: string | null;
  options: Record<string, string>;
  location_id: string;
  location_name: string;
  available: number;
  min_qty: number | null;
  target_qty: number | null;
  sold: number;
  daily: number;
  days_left: number | null;
  suggested: number;
  reason: "min" | "rotacion";
  sources: { location_id: string; name: string; spare: number }[];
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function useRestock(locationId: string | null, days: number, cover: number) {
  const { active } = useTenant();
  return useQuery({
    queryKey: ["inv", active?.tenant.id, "restock", locationId, days, cover],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("report_restock", { p_location_id: locationId, p_days: days, p_cover_days: cover });
      if (error) throw new Error(error.message);
      return ((data ?? []) as RestockRow[]).map((r) => ({
        ...r,
        available: Number(r.available),
        min_qty: num(r.min_qty),
        target_qty: num(r.target_qty),
        sold: Number(r.sold),
        daily: Number(r.daily),
        days_left: num(r.days_left),
        suggested: Number(r.suggested),
        sources: (r.sources ?? []).map((s) => ({ ...s, spare: Number(s.spare) })),
      }));
    },
  });
}

function useSetLevels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { variantId: string; locationId: string; min: number | null; target: number | null }) => {
      const { error } = await supabase.rpc("set_stock_levels", {
        p_variant_id: input.variantId,
        p_location_id: input.locationId,
        p_min: input.min,
        p_target: input.target,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inv"] }),
  });
}

const variantName = (r: RestockRow) => [r.name, ...Object.values(r.options ?? {})].join(" · ");

export default function RestockTab() {
  const { data: locations = [] } = useLocations();
  const [locationId, setLocationId] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [cover, setCover] = useState(15);
  const [editing, setEditing] = useState<RestockRow | null>(null);
  const { data: rows = [], isLoading, error } = useRestock(locationId, days, cover);

  const columns: Column<RestockRow>[] = [
    { header: "Producto", value: (r) => variantName(r), render: (r) => <span className="font-semibold">{variantName(r)}</span> },
    { header: "SKU", value: (r) => r.sku },
    { header: "Sede", value: (r) => r.location_name },
    { header: "Disponible", value: (r) => r.available, render: (r) => formatQty(r.available), align: "right" },
    { header: `Vendido ${days} d`, value: (r) => r.sold, render: (r) => formatQty(r.sold), align: "right" },
    { header: "Alcanza", value: (r) => r.days_left, render: (r) => (r.days_left === null ? "—" : `${formatQty(r.days_left)} d`), align: "right" },
    {
      header: "Mínimo / objetivo",
      value: (r) => (r.min_qty === null ? "" : `${r.min_qty} / ${r.target_qty ?? ""}`),
      render: (r) => (
        <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => setEditing(r)}>
          {r.min_qty === null ? "Fijar" : `${formatQty(r.min_qty)} / ${r.target_qty === null ? "—" : formatQty(r.target_qty)}`}
        </button>
      ),
    },
    { header: "Reponer", value: (r) => r.suggested, render: (r) => <strong>{formatQty(r.suggested)}</strong>, align: "right" },
    {
      header: "Desde",
      value: (r) => r.sources.map((s) => `${s.name}: ${s.spare}`).join(", "),
      render: (r) => (r.sources.length ? r.sources.map((s) => `${s.name} (${formatQty(s.spare)})`).join(", ") : <span className="text-muted-foreground">Comprar</span>),
    },
  ];

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Con mínimo, se repone al llegar a él hasta el objetivo. Sin mínimo, se calcula con lo vendido en los últimos {days} días para cubrir {cover} días.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="rs-loc">Sede</Label>
          <select
            id="rs-loc"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={locationId ?? ""}
            onChange={(e) => setLocationId(e.target.value || null)}
          >
            <option value="">Todas</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="rs-days">Ventas de los últimos</Label>
          <select id="rs-days" className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[15, 30, 60, 90].map((d) => (
              <option key={d} value={d}>
                {d} días
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="rs-cover">Cubrir</Label>
          <select id="rs-cover" className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={cover} onChange={(e) => setCover(Number(e.target.value))}>
            {[7, 15, 30, 45].map((d) => (
              <option key={d} value={d}>
                {d} días
              </option>
            ))}
          </select>
        </div>
      </div>
      <Panel title={`Por reponer (${rows.length})`} right={<ExportButton fileName="reposicion" rows={rows} columns={columns} />}>
        {isLoading ? (
          <p className="mono-cap text-xs text-muted-foreground">Calculando…</p>
        ) : error ? (
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        ) : (
          <DataTable rows={rows} columns={columns} rowKey={(r) => `${r.variant_id}-${r.location_id}`} empty="Nada por reponer con estos criterios." />
        )}
      </Panel>
      <LevelsDialog row={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function LevelsDialog({ row, onClose }: { row: RestockRow | null; onClose: () => void }) {
  const save = useSetLevels();
  const [min, setMin] = useState("");
  const [target, setTarget] = useState("");
  const [lastId, setLastId] = useState<string | null>(null);

  const key = row ? `${row.variant_id}-${row.location_id}` : null;
  if (row && key !== lastId) {
    setLastId(key);
    setMin(row.min_qty === null ? "" : String(row.min_qty));
    setTarget(row.target_qty === null ? "" : String(row.target_qty));
  }
  if (!row) return null;

  const submit = (event: FormEvent, clear = false) => {
    event.preventDefault();
    const m = clear || !min.trim() ? null : parseAmount(min);
    const t = clear || !target.trim() ? null : parseAmount(target);
    save.mutate(
      { variantId: row.variant_id, locationId: row.location_id, min: m, target: t },
      {
        onSuccess: () => {
          toast.success(clear ? "Mínimo quitado" : "Mínimo guardado");
          onClose();
        },
        onError: (err) => toast.error("No se pudo guardar", { description: err.message }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {variantName(row)} · {row.location_name}
          </DialogTitle>
        </DialogHeader>
        <form className="space-y-3" onSubmit={submit}>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="lv-min">Mínimo</Label>
              <Input id="lv-min" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lv-target">Objetivo</Label>
              <Input id="lv-target" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Al llegar al mínimo se sugiere reponer hasta el objetivo.</p>
          <div className="flex gap-2">
            <Button type="submit" disabled={save.isPending}>
              Guardar
            </Button>
            {row.min_qty !== null && (
              <Button type="button" variant="outline" disabled={save.isPending} onClick={(e) => submit(e, true)}>
                Quitar mínimo
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
