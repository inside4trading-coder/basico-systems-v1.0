/**
 * Herramientas de la tabla de inventario. Portado de CostHistoryButton y
 * BulkApplyField (basicosystems@f551478b):
 *   * Historial de costos de una variante (entradas con costo), solo lectura.
 *   * Aplicar precio, oferta o costo a todas las variantes de un producto.
 */
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/core/supabase";
import { parseAmount } from "./import/preview";
import { formatDateTime, formatMoney, formatQty } from "./lib";

interface CostEntry {
  id: string;
  created_at: string;
  qty_delta: number;
  unit_cost: number;
  supplier: string | null;
  locations: { name: string } | null;
}

export function CostHistoryButton({ variantId, name, currency }: { variantId: string; name: string; currency: string }) {
  const [open, setOpen] = useState(false);
  const { data: entries = [], isLoading } = useQuery({
    enabled: open,
    queryKey: ["inv", "cost-history", variantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_movements")
        .select("id, created_at, qty_delta, unit_cost, supplier, locations(name)")
        .eq("variant_id", variantId)
        .eq("kind", "entry")
        .not("unit_cost", "is", null)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return ((data ?? []) as unknown as CostEntry[]).map((e) => ({ ...e, qty_delta: Number(e.qty_delta), unit_cost: Number(e.unit_cost) }));
    },
  });

  return (
    <>
      <button type="button" className="text-muted-foreground hover:text-foreground" aria-label={`Historial de costos de ${name}`} title="Historial de costos" onClick={() => setOpen(true)}>
        <History className="h-3.5 w-3.5" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Costos de {name}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">Entradas de mercancía con costo, de la más reciente a la más vieja.</p>
          {isLoading && <p className="mono-cap text-xs text-muted-foreground">Cargando…</p>}
          {!isLoading && entries.length === 0 && <p className="text-sm text-muted-foreground">Sin entradas con costo todavía.</p>}
          <ul className="max-h-80 divide-y overflow-y-auto rounded-lg border text-sm">
            {entries.map((e) => (
              <li key={e.id} className="flex justify-between gap-3 p-2">
                <span className="min-w-0">
                  <span className="block">{formatDateTime(e.created_at)}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[e.locations?.name, `${formatQty(e.qty_delta)} u.`, e.supplier].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="num shrink-0 font-semibold">{formatMoney(e.unit_cost, currency)}</span>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}

type Field = "regular_price" | "price" | "cost";
const FIELD_LABEL: Record<Field, string> = { regular_price: "Precio", price: "Oferta", cost: "Costo" };

export function BulkApplyButton({ productId, productName, count }: { productId: string; productName: string; count: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<Field, string>>({ regular_price: "", price: "", cost: "" });
  const apply = useMutation({
    mutationFn: async (patch: Partial<Record<Field, number>>) => {
      const { error } = await supabase.from("variants").update(patch).eq("product_id", productId).is("deleted_at", null);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inv"] }),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const patch: Partial<Record<Field, number>> = {};
    for (const f of Object.keys(FIELD_LABEL) as Field[]) {
      if (!values[f].trim()) continue;
      const n = parseAmount(values[f]);
      if (n === null || !Number.isFinite(n) || n < 0) return toast.error(`${FIELD_LABEL[f]} inválido`);
      patch[f] = n;
    }
    if (Object.keys(patch).length === 0) return toast.error("Escribe al menos un valor");
    apply.mutate(patch, {
      onSuccess: () => {
        toast.success(`Aplicado a las ${count} variantes`);
        setOpen(false);
        setValues({ regular_price: "", price: "", cost: "" });
      },
      onError: (err) => toast.error("No se pudo aplicar", { description: err.message }),
    });
  };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-6 px-2 text-xs"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        Aplicar a las {count}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>{productName}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">Los valores que escribas se copian a sus {count} variantes. Lo que dejes vacío no cambia.</p>
          <form className="space-y-3" onSubmit={submit}>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(FIELD_LABEL) as Field[]).map((f) => (
                <div key={f} className="space-y-1">
                  <Label htmlFor={`bulk-${f}`}>{FIELD_LABEL[f]}</Label>
                  <Input id={`bulk-${f}`} inputMode="decimal" className="num" value={values[f]} onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))} />
                </div>
              ))}
            </div>
            <Button type="submit" className="w-full" disabled={apply.isPending}>
              Aplicar
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
