/** Historial de impresión de etiquetas: qué, cuántas, con qué plantilla, quién y cuándo. */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";

interface Job {
  id: string;
  kind: "price" | "unit";
  template_name: string;
  quantity: number;
  is_reprint: boolean;
  reason: string | null;
  printed_at: string;
  printed_by_email: string | null;
  label_codes: string[] | null;
}

const KIND_LABEL: Record<Job["kind"], string> = { price: "Precio", unit: "Por unidad" };
const when = (iso: string) =>
  new Intl.DateTimeFormat("es-VE", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Caracas" }).format(new Date(iso));

export default function HistoryPanel() {
  const { active } = useTenant();
  const [kind, setKind] = useState<"all" | Job["kind"]>("all");
  const history = useQuery({
    queryKey: ["label-history", active?.tenant.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("label_print_history", { p_limit: 300 });
      if (error) throw new Error(error.message);
      return (data ?? []) as Job[];
    },
  });
  const jobs = (history.data ?? []).filter((j) => kind === "all" || j.kind === kind);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Tipo">
        {(["all", "price", "unit"] as const).map((k) => (
          <Button key={k} size="sm" variant={kind === k ? "default" : "outline"} aria-pressed={kind === k} onClick={() => setKind(k)}>
            {k === "all" ? "Todas" : KIND_LABEL[k]}
          </Button>
        ))}
      </div>
      {history.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {history.isError && <p className="text-sm text-destructive">{(history.error as Error).message}</p>}
      {!history.isLoading && jobs.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay impresiones.</p>}
      {jobs.length > 0 && (
        <ul className="divide-y rounded-xl border bg-card">
          {jobs.map((j) => (
            <li key={j.id} className="space-y-0.5 p-3 text-sm">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">
                  {j.quantity} etiqueta{j.quantity === 1 ? "" : "s"}
                </span>
                <Badge variant="secondary">{KIND_LABEL[j.kind]}</Badge>
                {j.is_reprint && <Badge variant="outline">Reimpresión</Badge>}
                <span className="text-muted-foreground">· {j.template_name}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {when(j.printed_at)}
                {j.printed_by_email && ` · ${j.printed_by_email}`}
                {j.reason && ` · Motivo: ${j.reason}`}
              </p>
              {j.label_codes && j.label_codes.length > 0 && (
                <p className="mono truncate text-xs text-muted-foreground">
                  {j.label_codes.join(", ")}
                  {j.quantity > j.label_codes.length ? ` y ${j.quantity - j.label_codes.length} más` : ""}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
