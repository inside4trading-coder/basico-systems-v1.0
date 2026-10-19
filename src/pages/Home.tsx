import { Link } from "react-router-dom";
import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { useTenant } from "@/core/tenant-context";
import { canSupervise } from "@/core/tenant-selection";
import { useLocations } from "@/modules/inventory/api";

export default function Home() {
  const { active } = useTenant();
  const { data: locations, isLoading } = useLocations();
  const noLocations = !isLoading && (locations?.length ?? 0) === 0;

  return (
    <AppShell>
      <h1 className="text-2xl">{active?.tenant.name}</h1>
      {noLocations && canSupervise(active?.role) ? (
        <div className="space-y-3 rounded-surface border bg-card p-4">
          <p className="text-sm">Para empezar, crea al menos una sede: la tienda o el almacén donde está tu mercancía.</p>
          <Button asChild>
            <Link to="/sedes">Crear sede</Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Button asChild variant="outline" className="h-16">
            <Link to="/inventario">Inventario</Link>
          </Button>
          <Button asChild variant="outline" className="h-16">
            <Link to="/control">Entradas, ajustes y traslados</Link>
          </Button>
        </div>
      )}
    </AppShell>
  );
}
