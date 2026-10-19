import BrandMark from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/core/auth";

export default function NoAccess({ reason }: { reason: "no-tenant" | "suspended" }) {
  const { session, signOut } = useAuth();

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
        <Button variant="outline" className="w-full" onClick={signOut}>
          Salir
        </Button>
      </div>
    </main>
  );
}
