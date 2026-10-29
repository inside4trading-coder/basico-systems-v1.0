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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useTenant } from "@/core/tenant-context";
import { useMarkStep } from "@/modules/onboarding/api";
import { useCatalog, useLocations } from "./api";
import { useAttributeDefs, useImportJobs, useUndoImport, type ImportJob } from "./import/api";
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
  const [undoing, setUndoing] = useState<ImportJob | null>(null);
  const undo = useUndoImport();

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
                <span className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  {j.total_rows} filas · {j.result.variants_created ?? 0} nuevas · {j.result.variants_updated ?? 0} actualizadas · {formatDateTime(j.created_at)}
                  {j.undone_at ? (
                    <span>
                      Deshecha · {formatDateTime(j.undone_at)}
                      {j.undo_result && j.undo_result.kept > 0 && ` · ${j.undo_result.kept} se quedaron`}
                    </span>
                  ) : (
                    (j.result.products_created ?? 0) > 0 && (
                      <Button size="sm" variant="outline" onClick={() => setUndoing(j)}>
                        Deshacer importación
                      </Button>
                    )
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <AlertDialog open={undoing !== null} onOpenChange={(open) => !open && setUndoing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Deshacer esta importación?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borrarán los {undoing?.result.products_created ?? 0} productos que creó «{undoing?.file_name}», con sus existencias. Los que ya se vendieron, ajustaron
              o contaron se quedan. Los productos que ya tenías antes conservan los cambios de precio y existencia.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={undo.isPending}
              onClick={() =>
                undoing &&
                undo.mutate(undoing.id, {
                  onSuccess: (r) =>
                    toast.success(`Se borraron ${r.removed} productos`, {
                      description: r.kept > 0 ? `${r.kept} se quedaron porque ya tenían movimientos: ${r.kept_names.join(", ")}` : undefined,
                    }),
                  onError: (err) => toast.error("No se pudo deshacer", { description: err.message }),
                  onSettled: () => setUndoing(null),
                })
              }
            >
              Deshacer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
