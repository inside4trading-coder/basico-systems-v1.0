import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { LogOut, PanelLeftClose, Shield } from "lucide-react";
import BrandMark from "@/components/BrandMark";
import { useAuth } from "@/core/auth";
import { cn } from "@/lib/utils";
import { useIsPlatformAdmin } from "@/modules/onboarding/api";
import { isItemActive, moduleForPath, type NavModule } from "./nav/navModules";
import { useNavModules } from "./nav/useNav";

/** Lista de submódulos de un módulo (se usa en el panel y en el menú del teléfono). */
export function ModuleLinks({ module, onNavigate }: { module: NavModule; onNavigate?: () => void }) {
  const location = useLocation();
  const siblings = module.groups.flatMap((g) => g.items);
  return (
    <div className="space-y-4">
      {module.groups.map((group, i) => (
        <div key={group.label ?? i} className="space-y-1">
          {group.label && <p className="mono-cap px-3 pt-1 text-[10px] text-muted-foreground">{group.label}</p>}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = isItemActive(item, location, siblings);
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block rounded-md px-3 py-1.5 text-sm transition-colors",
                      active ? "bg-primary font-semibold text-primary-foreground" : "text-foreground/80 hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * Menú lateral de escritorio, como el del ERP: columna de iconos con los
 * módulos y, al lado, el panel con los submódulos del módulo abierto. El
 * panel se pliega para dejar más espacio a la pantalla.
 */
export default function AppSidebar({ collapsed, onCollapse }: { collapsed: boolean; onCollapse: (v: boolean) => void }) {
  const modules = useNavModules();
  const location = useLocation();
  const { signOut } = useAuth();
  const platform = useIsPlatformAdmin();
  const current = moduleForPath(location.pathname, modules);
  const [openKey, setOpenKey] = useState<string | null>(current?.key ?? modules[0]?.key ?? null);

  // Al cambiar de página, el panel muestra el módulo de esa página.
  const currentKey = current?.key ?? null;
  useEffect(() => {
    if (currentKey) setOpenKey(currentKey);
  }, [currentKey, location.pathname]);

  const open = modules.find((m) => m.key === openKey) ?? current ?? modules[0];

  const pick = (key: string) => {
    if (key === open?.key && !collapsed) return onCollapse(true);
    setOpenKey(key);
    if (collapsed) onCollapse(false);
  };

  return (
    <aside className="sticky top-0 hidden h-screen shrink-0 lg:flex" aria-label="Menú">
      <nav className="flex w-14 flex-col items-center gap-1 bg-sidebar py-3 text-sidebar-foreground" aria-label="Módulos">
        <Link to="/" aria-label="Inicio" className="mb-3 text-lg font-bold text-sidebar-primary-foreground">
          B
        </Link>
        {modules.map((m) => {
          const Icon = m.icon;
          const isCurrent = m.key === current?.key;
          const isOpen = m.key === open?.key && !collapsed;
          return (
            <button
              key={m.key}
              type="button"
              title={m.label}
              aria-label={m.label}
              aria-expanded={isOpen}
              onClick={() => pick(m.key)}
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
                isCurrent ? "bg-sidebar-primary text-sidebar-primary-foreground" : isOpen ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="h-5 w-5" aria-hidden />
            </button>
          );
        })}
        <div className="mt-auto flex flex-col items-center gap-1">
          {platform.data && (
            <Link
              to="/plataforma"
              title="Plataforma"
              aria-label="Plataforma"
              className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <Shield className="h-5 w-5" aria-hidden />
            </Link>
          )}
          <button
            type="button"
            title="Salir"
            aria-label="Salir"
            onClick={signOut}
            className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <LogOut className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </nav>

      {!collapsed && open && (
        <div className="flex w-60 flex-col border-r bg-card">
          <div className="flex items-start justify-between gap-2 border-b px-4 py-4">
            <div className="min-w-0">
              <BrandMark className="mb-3 text-base" />
              <p className="mono-cap text-[10px] text-muted-foreground">Módulo</p>
              <p className="font-semibold">{open.label}</p>
              <p className="text-xs text-muted-foreground">{open.caption}</p>
            </div>
            <button
              type="button"
              title="Plegar el menú"
              aria-label="Plegar el menú"
              onClick={() => onCollapse(true)}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <PanelLeftClose className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-3">
            <ModuleLinks module={open} />
          </div>
        </div>
      )}
    </aside>
  );
}
