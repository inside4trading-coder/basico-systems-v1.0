import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, PanelLeftOpen } from "lucide-react";
import AppSidebar, { ModuleLinks } from "@/components/AppSidebar";
import { useNavModules, useSidebarCollapsed } from "@/components/nav/useNav";
import BrandMark from "@/components/BrandMark";
import RateBadge from "@/components/RateBadge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/core/auth";
import { useTenant } from "@/core/tenant-context";
import type { TenantRole } from "@/core/tenant-selection";
import { cn } from "@/lib/utils";
import { useTrackRecent } from "@/modules/home/recent";
import { useRateAutoSync } from "@/modules/settings/useRateAutoSync";
import { useIsPlatformAdmin } from "@/modules/onboarding/api";
import { showTrialNotice, trialDaysLeft } from "@/modules/onboarding/lib";

export const ROLE_LABELS: Record<TenantRole, string> = {
  owner: "Dueño",
  admin: "Administrador",
  manager: "Encargado",
  cajero: "Cajero",
};

/** Menú completo en el teléfono: todos los módulos con sus submódulos. */
function MobileMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const modules = useNavModules();
  const platform = useIsPlatformAdmin();
  const { signOut } = useAuth();
  const location = useLocation();
  useEffect(() => onOpenChange(false), [location.pathname, location.search, location.hash, onOpenChange]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-80 overflow-y-auto p-0">
        <SheetHeader className="border-b px-4 py-3 text-left">
          <SheetTitle>
            <BrandMark className="text-lg" />
          </SheetTitle>
        </SheetHeader>
        <div className="space-y-5 px-2 py-3">
          {modules.map((m) => {
            const Icon = m.icon;
            return (
              <section key={m.key} className="space-y-1">
                <p className="flex items-center gap-2 px-3 text-sm font-semibold">
                  <Icon className="h-4 w-4 text-primary" aria-hidden /> {m.label}
                </p>
                <ModuleLinks module={m} onNavigate={() => onOpenChange(false)} />
              </section>
            );
          })}
          <div className="space-y-1 border-t px-3 pt-3 text-sm">
            {platform.data && (
              <Link to="/plataforma" className="block py-1.5">
                Plataforma
              </Link>
            )}
            <button type="button" className="py-1.5 text-muted-foreground" onClick={signOut}>
              Salir
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function AppShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { session, signOut } = useAuth();
  const { active, memberships, clearTenant, can } = useTenant();
  const role = active?.role;
  const daysLeft = trialDaysLeft(active?.tenant.trial_ends_at);
  const trialNotice = can("config.negocio") && showTrialNotice(daysLeft);
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const [mobileOpen, setMobileOpen] = useState(false);
  useRateAutoSync();
  useTrackRecent(active?.tenant.id);

  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar collapsed={collapsed} onCollapse={setCollapsed} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Button size="icon" variant="ghost" className="lg:hidden" aria-label="Abrir el menú" onClick={() => setMobileOpen(true)}>
              <Menu className="h-5 w-5" />
            </Button>
            {collapsed && (
              <Button size="icon" variant="ghost" className="hidden lg:inline-flex" aria-label="Mostrar el menú" title="Mostrar el menú" onClick={() => setCollapsed(false)}>
                <PanelLeftOpen className="h-5 w-5" />
              </Button>
            )}
            <Link to="/" aria-label="Inicio" className="lg:hidden">
              <BrandMark className="text-lg" />
            </Link>
          </div>
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
            <Button size="sm" variant="outline" className="lg:hidden" onClick={signOut}>
              Salir
            </Button>
          </div>
        </header>
        {trialNotice && daysLeft !== null && (
          <div role="status" className="border-b bg-amber-50 px-4 py-2 text-center text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
            {daysLeft > 0
              ? `Tu prueba gratis termina en ${daysLeft} día${daysLeft === 1 ? "" : "s"}. Escríbenos para activar tu plan.`
              : "Tu prueba gratis terminó. Escríbenos para activar tu plan."}
          </div>
        )}
        <main className={cn("mx-auto w-full space-y-6 p-4", wide ? "max-w-[1400px]" : "max-w-3xl")}>{children}</main>
      </div>
      <MobileMenu open={mobileOpen} onOpenChange={setMobileOpen} />
    </div>
  );
}
