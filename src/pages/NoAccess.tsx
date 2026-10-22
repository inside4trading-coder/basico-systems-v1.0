import { Link } from "react-router-dom";
import BrandMark from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/core/auth";
import { useIsPlatformAdmin } from "@/modules/onboarding/api";

export default function NoAccess({ reason }: { reason: "no-tenant" | "suspended" }) {
  const { session, signOut } = useAuth();
  const platform = useIsPlatformAdmin();

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6 rounded-surface border bg-card p-8 text-center shadow-sm">
        <BrandMark className="text-3xl" />
        {reason === "no-tenant" ? (
          <p className="text-sm text-muted-foreground">
            {session?.user.email} todavía no pertenece a ningún negocio. Pide a tu administrador que te invite.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Esta cuenta está suspendida. Escríbenos para reactivarla; tus datos siguen intactos.
          </p>
        )}
        {platform.data && (
          <Button asChild className="w-full">
            <Link to="/plataforma">Ir a Plataforma</Link>
          </Button>
        )}
        <Button variant="outline" className="w-full" onClick={signOut}>
          Salir
        </Button>
      </div>
    </main>
  );
}
