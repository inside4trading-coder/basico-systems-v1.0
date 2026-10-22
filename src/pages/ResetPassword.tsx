import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import BrandMark from "@/components/BrandMark";
import NewPasswordForm from "@/components/NewPasswordForm";
import { useAuth } from "@/core/auth";

/**
 * Destino del correo «Restablecer contraseña». El enlace abre una sesión de
 * recuperación (supabase-js la lee de la URL); con ella se fija la nueva.
 */
export default function ResetPassword() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  // El token llega en la URL y la sesión aparece un instante después.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setWaited(true), 2500);
    return () => window.clearTimeout(timer);
  }, []);

  if (session) {
    return (
      <NewPasswordForm
        title="Nueva contraseña"
        description={`Para ${session.user.email}`}
        data={{ needs_password: false }}
        onDone={() => navigate("/", { replace: true })}
      />
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6 rounded-surface border bg-card p-8 text-center shadow-sm">
        <BrandMark className="text-3xl" />
        {loading || !waited ? (
          <p className="mono-cap text-xs text-muted-foreground">Verificando el enlace…</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Este enlace ya se usó o venció. Pide uno nuevo desde «¿Olvidaste tu contraseña?».
            </p>
            <Link to="/login" className="text-sm font-medium underline underline-offset-4">
              Volver a entrar
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
