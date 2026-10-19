import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import BrandMark from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/core/auth";
import type { ModuleKey } from "@/core/entitlements";
import { useEntitlements } from "@/core/useEntitlements";
import { useTenant } from "@/core/tenant-context";
import { canManageTeam, canSeeReports, canSupervise, type TenantRole } from "@/core/tenant-selection";
import { cn } from "@/lib/utils";
import { useCurrentRate } from "@/modules/settings/api";
import { useRateAutoSync } from "@/modules/settings/useRateAutoSync";

export const ROLE_LABELS: Record<TenantRole, string> = {
  owner: "Dueño",
  admin: "Administrador",
  manager: "Encargado",
  cajero: "Cajero",
};

interface NavItem {
  to: string;
  label: string;
  visible: (role: TenantRole | undefined) => boolean;
  /** Módulo del plan que tiene que estar incluido. */
  module?: ModuleKey;
}

const NAV: NavItem[] = [
  { to: "/", label: "Inicio", visible: () => true },
  { to: "/pos", label: "Vender", visible: () => true, module: "pos" },
  { to: "/inventario", label: "Inventario", visible: () => true, module: "inventario" },
  { to: "/control", label: "Control", visible: () => true, module: "inventario" },
  { to: "/reportes", label: "Reportes", visible: canSeeReports, module: "reportes" },
  { to: "/administracion", label: "Administración", visible: canSeeReports, module: "administracion" },
  { to: "/sedes", label: "Sedes", visible: canSupervise },
  { to: "/configuracion", label: "Configuración", visible: canSupervise },
  { to: "/equipo", label: "Equipo", visible: canManageTeam },
];

export default function AppShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { session, signOut } = useAuth();
  const { active, memberships, clearTenant } = useTenant();
  const role = active?.role;
  const entitlements = useEntitlements();
  useRateAutoSync();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link to="/" aria-label="Inicio">
            <BrandMark className="text-xl" />
          </Link>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <RateBadge />
            <span className="font-semibold">{active?.tenant.name}</span>
            {role && <span className="mono-cap text-[10px] text-muted-foreground">{ROLE_LABELS[role]}</span>}
            {memberships.length > 1 && (
              <Button size="sm" variant="ghost" onClick={clearTenant}>
                Cambiar
              </Button>
            )}
            <span className="hidden text-muted-foreground md:inline">{session?.user.email}</span>
            <Button size="sm" variant="outline" onClick={signOut}>
              Salir
            </Button>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2" aria-label="Secciones">
          {NAV.filter((item) => item.visible(role) && (!item.module || entitlements[item.module])).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors",
                  isActive ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className={cn("mx-auto space-y-6 p-4", wide ? "max-w-[1400px]" : "max-w-3xl")}>{children}</main>
    </div>
  );
}

/** Tasa vigente siempre a la vista: el cajero cobra con ella. */
function RateBadge() {
  const { data: rate } = useCurrentRate();
  if (!rate) return null;
  return (
    <span
      className={cn("num rounded-md border px-2 py-0.5 text-xs", rate.stale ? "border-destructive text-destructive" : "text-muted-foreground")}
      title={rate.stale ? "Tasa vieja" : `Rige desde ${rate.effective_date}`}
    >
      Tasa {rate.rate.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  );
}
