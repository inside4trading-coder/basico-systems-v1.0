import { useNavigate } from "react-router-dom";
import BrandMark from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/core/auth";
import { useTenant } from "@/core/tenant-context";

export default function SelectTenant() {
  const { memberships, selectTenant } = useTenant();
  const { signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6 rounded-surface border bg-card p-8 shadow-sm">
        <div className="flex flex-col items-center gap-3">
          <BrandMark className="text-3xl" />
          <p className="mono-cap text-xs text-muted-foreground">Elige un negocio</p>
        </div>
        <ul className="space-y-2">
          {memberships.map((m) => (
            <li key={m.tenant.id}>
              <button
                type="button"
                onClick={() => {
                  selectTenant(m.tenant.id);
                  navigate("/", { replace: true });
                }}
                className="flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors hover:bg-accent"
              >
                <span className="font-semibold">{m.tenant.name}</span>
                <span className="mono-cap text-[10px] text-muted-foreground">{m.role}</span>
              </button>
            </li>
          ))}
        </ul>
        <Button variant="ghost" className="w-full" onClick={signOut}>
          Salir
        </Button>
      </div>
    </main>
  );
}
