/** Qué incluye el plan del negocio y cuánto de cada cuota está en uso. */
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { MODULE_LABELS, type ModuleKey } from "@/core/entitlements";
import { useEntitlements, usePlanUsage } from "@/core/useEntitlements";
import { cn } from "@/lib/utils";

// Cashea queda fuera hasta que su módulo dependa del plan (hoy funciona en todos).
const MODULES: ModuleKey[] = ["pos", "inventario", "administracion", "reportes", "fichaje", "estudio"];

export default function PlanSection() {
  const entitlements = useEntitlements();
  const { data: usage } = usePlanUsage(true);

  const quotas = [
    { label: "Sedes", used: usage?.locations, limit: entitlements.max_locations },
    { label: "Cajas activas", used: usage?.registers, limit: entitlements.max_registers },
    { label: "Usuarios", used: usage?.users, limit: entitlements.max_users },
  ];

  return (
    <Card className="space-y-4 p-4">
      <div>
        <h2 className="text-base">Tu plan</h2>
        <p className="text-sm text-muted-foreground">Para sumar sedes, cajas, usuarios o un complemento, escríbenos.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {quotas.map((q) => (
          <div key={q.label} className="rounded-md border p-3">
            <p className="mono-cap text-[10px] text-muted-foreground">{q.label}</p>
            <p className={cn("num text-xl font-bold", q.used !== undefined && q.used >= q.limit && "text-destructive")}>
              {q.used ?? "–"} <span className="text-sm font-normal text-muted-foreground">de {q.limit}</span>
            </p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {MODULES.map((m) => (
          <Badge key={m} variant={entitlements[m] ? "default" : "outline"} className={cn(!entitlements[m] && "text-muted-foreground")}>
            {MODULE_LABELS[m]}
            {entitlements[m] ? "" : " · no incluido"}
          </Badge>
        ))}
      </div>
    </Card>
  );
}
