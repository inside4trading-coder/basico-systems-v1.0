import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import BrandMark from "@/components/BrandMark";
import RateBadge from "@/components/RateBadge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/core/auth";
import { useTenant } from "@/core/tenant-context";
import { useRateAutoSync } from "@/modules/settings/useRateAutoSync";

/**
 * Marco del POS a pantalla completa: sin el menú de la app, solo una barra
 * fina con el negocio, la tasa y «Salir del POS». El carrito sigue guardado
 * al salir y volver.
 */
export default function PosShell({ children }: { children: ReactNode }) {
  const { active } = useTenant();
  const { session } = useAuth();
  const navigate = useNavigate();
  // La tasa se mantiene al día también dentro del POS.
  useRateAutoSync();

  return (
    <div className="min-h-screen bg-background">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-2">
        <div className="flex items-center gap-3">
          <BrandMark className="text-lg" />
          <span className="mono-cap text-[10px] text-muted-foreground">Punto de venta</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <RateBadge />
          <span className="font-semibold">{active?.tenant.name}</span>
          <span className="hidden text-muted-foreground md:inline">{session?.user.email}</span>
          <Button size="sm" variant="outline" onClick={() => navigate("/")}>
            <LogOut className="h-4 w-4" /> Salir del POS
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] space-y-4 p-4">{children}</main>
    </div>
  );
}
