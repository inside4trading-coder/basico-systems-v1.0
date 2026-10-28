/**
 * Inventario → Importar y exportar. Portado de SublimeInventarioImportExport.tsx
 * (basicosystems@f551478b). El importador vive en import/CatalogImporter
 * (también se usa dentro del alta); aquí van la plantilla, la exportación y
 * el historial.
 */
import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Download, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import BackLink from "@/components/BackLink";
import { Button } from "@/components/ui/button";
import { useTenant } from "@/core/tenant-context";
import { useMarkStep } from "@/modules/onboarding/api";
import { useCatalog, useLocations } from "./api";
import { useAttributeDefs, useImportJobs } from "./import/api";
import CatalogImporter from "./import/CatalogImporter";
import { exportCatalog, downloadTemplate } from "./import/exportCatalog";
import { RUBROS } from "./import/rubros";
import { formatDateTime } from "./lib";

export default function ImportPage() {
  const { active, can } = useTenant();
  // Enlaces viejos desde el alta: al importar, volver a ella con el paso hecho.
  const [params] = useSearchParams();
  const fromWizard = params.get("desde") === "bienvenida";
  const navigate = useNavigate();
  const markStep = useMarkStep();
  const { data: catalog } = useCatalog();
  const { data: locations = [] } = useLocations();
  const { data: defs = [] } = useAttributeDefs();
  const { data: jobs = [] } = useImportJobs();
  const [rubroId, setRubroId] = useState(RUBROS[0].id);

  if (!can("catalogo.editar")) return <Navigate to="/inventario" replace />;

  return (
    <AppShell wide>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {fromWizard ? <BackLink to="/bienvenida">Primeros pasos</BackLink> : <BackLink to="/inventario">Inventario</BackLink>}
          <h1 className="text-2xl">Importar y exportar</h1>
          <p className="text-sm text-muted-foreground">Sube tu Excel como lo tengas; te ayudamos a ubicar nombre, código, precio y existencia.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Rubro de la plantilla"
            value={rubroId}
            onChange={(e) => setRubroId(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            {RUBROS.map((r) => (
              <option key={r.id} value={r.id}>
                Plantilla: {r.name}
              </option>
            ))}
          </select>
          <Button variant="outline" onClick={() => downloadTemplate(RUBROS.find((r) => r.id === rubroId), locations)}>
            <Download /> Plantilla
          </Button>
          <Button
            variant="outline"
            disabled={!catalog?.rows.length}
            onClick={() =>
              exportCatalog(catalog!.rows, locations, defs, active?.tenant.slug ?? "negocio").catch((err) =>
                toast.error("No se pudo exportar", { description: (err as Error).message }),
              )
            }
          >
            <FileSpreadsheet /> Exportar catálogo
          </Button>
        </div>
      </div>

      <CatalogImporter onImported={() => fromWizard && markStep.mutate("productos", { onSettled: () => navigate("/bienvenida") })} />

      {jobs.length > 0 && (
        <section className="space-y-2">
          <p className="mono-cap text-xs text-muted-foreground">Importaciones anteriores</p>
          <ul className="divide-y rounded-surface border bg-card">
            {jobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                <span className="font-medium">{j.file_name}</span>
                <span className="text-xs text-muted-foreground">
                  {j.total_rows} filas · {j.result.variants_created ?? 0} nuevas · {j.result.variants_updated ?? 0} actualizadas · {formatDateTime(j.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </AppShell>
  );
}
