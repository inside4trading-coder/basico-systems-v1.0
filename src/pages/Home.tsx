import { Link } from "react-router-dom";
import BrandMark from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/core/auth";
import { useTenant } from "@/core/tenant-context";
import { canManageTeam } from "@/core/tenant-selection";

export function AppHeader() {
  const { session, signOut } = useAuth();
  const { active, memberships, clearTenant } = useTenant();

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3">
      <Link to="/" aria-label="Inicio">
        <BrandMark className="text-xl" />
      </Link>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">{active?.tenant.name}</span>
        <span className="mono-cap text-[10px] text-muted-foreground">{active?.role}</span>
        {memberships.length > 1 && (
          <Button size="sm" variant="ghost" onClick={clearTenant}>
            Cambiar
          </Button>
        )}
        <span className="hidden text-muted-foreground sm:inline">{session?.user.email}</span>
        <Button size="sm" variant="outline" onClick={signOut}>
          Salir
        </Button>
      </div>
    </header>
  );
}

export default function Home() {
  const { active } = useTenant();

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-3xl space-y-4 p-4">
        <h1 className="text-2xl">{active?.tenant.name}</h1>
        <p className="text-sm text-muted-foreground">Catálogo, inventario y POS llegan en las siguientes fases.</p>
        {canManageTeam(active?.role) && (
          <Button asChild variant="outline">
            <Link to="/equipo">Equipo</Link>
          </Button>
        )}
      </main>
    </div>
  );
}
