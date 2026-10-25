/**
 * Buscar una etiqueta por unidad: por código, serial (se puede escanear), SKU
 * o nombre. Muestra de qué entrada vino, cuántas veces se imprimió, y deja
 * reimprimir o desactivar.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Printer, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";
import { usePrintUnits, useTemplateChoice } from "./printing";
import { ITEM_STATUS_LABEL, useDisableItemLabels, type ItemLabel, type ItemLabelStatus } from "./unitsApi";

interface Hit {
  id: string;
  code: string;
  is_serial: boolean;
  status: ItemLabelStatus;
  origin: string;
  disabled_reason: string | null;
  created_at: string;
  printed_at: string | null;
  disabled_at: string | null;
  variant_id: string;
  sku: string | null;
  options: Record<string, string> | null;
  product_id: string;
  product_name: string;
  entry_at: string | null;
  entry_note: string | null;
  entry_supplier: string | null;
  times_printed: number;
}

const ORIGIN_LABEL: Record<string, string> = { manual: "Manual", recepcion: "Recepción" };

const when = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("es-VE", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Caracas" }).format(new Date(iso)) : "—";

export default function SearchPanel() {
  const { active, can } = useTenant();
  const editable = can("inventario.etiquetas");
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [term, setTerm] = useState("");
  const { template } = useTemplateChoice();
  const print = usePrintUnits(template);
  const disable = useDisableItemLabels();

  useEffect(() => {
    const t = setTimeout(() => setTerm(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  const results = useQuery({
    queryKey: ["item-labels", active?.tenant.id, "search", term],
    enabled: term.length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("search_item_labels", { p_query: term });
      if (error) throw new Error(error.message);
      return ((data ?? []) as Hit[]).map((h) => ({ ...h, times_printed: Number(h.times_printed) }));
    },
  });

  const asLabel = (h: Hit): ItemLabel => ({
    id: h.id,
    variant_id: h.variant_id,
    unit_number: null,
    code: h.code,
    is_serial: h.is_serial,
    status: h.status,
    origin: h.origin,
    disabled_reason: h.disabled_reason,
    created_at: h.created_at,
    printed_at: h.printed_at,
  });

  const reprint = (h: Hit) =>
    print([asLabel(h)])
      .then(() => qc.invalidateQueries({ queryKey: ["item-labels"] }))
      .catch((e) => toast.error("No se pudo imprimir", { description: (e as Error).message }));

  const off = (h: Hit) => {
    const reason = window.prompt(`Motivo para desactivar ${h.code} (pieza dañada, perdida…)`);
    if (!reason?.trim()) return;
    disable.mutate({ ids: [h.id], reason }, { onSuccess: () => toast.success(`${h.code} desactivada`), onError: (e) => toast.error(e.message) });
  };

  const hits = results.data ?? [];
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Escanea o escribe el código, serial, SKU o nombre"
          className="h-12 pl-9 text-base"
          aria-label="Buscar etiqueta"
          autoFocus
        />
      </div>
      {term.length >= 2 && results.isFetching && <p className="mono-cap text-xs text-muted-foreground">Buscando…</p>}
      {term.length >= 2 && !results.isFetching && hits.length === 0 && (
        <p className="text-sm text-muted-foreground">Ninguna etiqueta coincide con «{term}».</p>
      )}
      {hits.length > 0 && (
        <ul className="divide-y rounded-xl border bg-card">
          {hits.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
              <div className="min-w-0 space-y-0.5">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="mono font-semibold">{h.code}</span>
                  {h.is_serial && <Badge variant="outline">Serial</Badge>}
                  <Badge variant={h.status === "disabled" ? "destructive" : h.status === "printed" ? "secondary" : "default"}>
                    {ITEM_STATUS_LABEL[h.status]}
                  </Badge>
                </p>
                <p>
                  {h.product_name}
                  {Object.values(h.options ?? {}).length > 0 && (
                    <span className="text-muted-foreground"> · {Object.values(h.options ?? {}).join(" · ")}</span>
                  )}
                  {h.sku && <span className="mono text-xs text-muted-foreground"> · {h.sku}</span>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {ORIGIN_LABEL[h.origin] ?? h.origin} · creada {when(h.created_at)}
                  {h.entry_at && ` · entrada del ${when(h.entry_at)}${h.entry_note ? ` (${h.entry_note})` : ""}${h.entry_supplier ? ` · ${h.entry_supplier}` : ""}`}
                  {` · impresa ${h.times_printed} ${h.times_printed === 1 ? "vez" : "veces"}`}
                  {h.disabled_reason && ` · desactivada: ${h.disabled_reason}`}
                </p>
              </div>
              {editable && h.status !== "disabled" && (
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => reprint(h)}>
                    <Printer className="h-4 w-4" /> {h.status === "printed" ? "Reimprimir" : "Imprimir"}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={disable.isPending} onClick={() => off(h)}>
                    <Ban className="h-4 w-4" /> Desactivar
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
