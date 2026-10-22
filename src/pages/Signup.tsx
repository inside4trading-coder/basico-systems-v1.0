import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import BrandMark from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/core/auth";
import { passwordProblem } from "@/core/password";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";
import { createSignupAccount, INVALID_REASONS, redeemInvite, useInviteInfo } from "@/modules/onboarding/api";

function Card({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6 rounded-surface border bg-card p-8 shadow-sm">
        <div className="flex flex-col items-center gap-3">
          <BrandMark className="text-4xl" />
          <p className="mono-cap text-xs text-muted-foreground">Crea tu negocio</p>
        </div>
        {children}
      </div>
    </main>
  );
}

/**
 * /alta/:code: alta de un negocio con el enlace que manda la plataforma.
 * Sin sesión crea la cuenta y el negocio; con sesión solo crea el negocio.
 */
export default function Signup() {
  const { code = "" } = useParams();
  const { session, loading: authLoading, signOut } = useAuth();
  const { selectTenant } = useTenant();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const info = useInviteInfo(code.toLowerCase());

  const [businessName, setBusinessName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [existing, setExisting] = useState(false);

  if (authLoading || info.isLoading) {
    return (
      <Card>
        <p className="text-center text-sm text-muted-foreground">Revisando el enlace…</p>
      </Card>
    );
  }

  if (info.isError || !info.data) {
    return (
      <Card>
        <p className="text-sm text-destructive">No se pudo revisar el enlace. Revisa tu conexión y recarga la página.</p>
      </Card>
    );
  }

  if (!info.data.valid) {
    return (
      <Card>
        <p className="text-sm text-muted-foreground">{INVALID_REASONS[info.data.reason]}</p>
        <Button asChild variant="outline" className="w-full">
          <Link to="/login">Entrar</Link>
        </Button>
      </Card>
    );
  }

  const invite = info.data;
  const loginWithCode = `/login?alta=${encodeURIComponent(code)}`;

  const finish = async (accountEmail: string) => {
    const tenantId = await redeemInvite(code, businessName.trim());
    // Primero se recuerda el negocio nuevo y luego se recargan las membresías:
    // así arranca directo en él.
    selectTenant(tenantId);
    await qc.refetchQueries({ queryKey: ["memberships"] });
    navigate("/", { replace: true });
    return accountEmail;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (businessName.trim().length < 2) return setError("Escribe el nombre de tu negocio");

    if (session) {
      setBusy(true);
      try {
        await finish(session.user.email ?? "");
      } catch (e) {
        setError((e as Error).message);
        setBusy(false);
      }
      return;
    }

    const accountEmail = (invite.email ?? email).trim().toLowerCase();
    if (fullName.trim().length < 2) return setError("Escribe tu nombre");
    const problem = passwordProblem(password, confirm);
    if (problem) return setError(problem);

    setBusy(true);
    try {
      const result = await createSignupAccount({ code, email: accountEmail, password, fullName: fullName.trim() });
      if (result.existing) {
        setExisting(true);
        setBusy(false);
        return;
      }
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: accountEmail, password });
      if (signInError) throw new Error("La cuenta se creó, pero no se pudo entrar. Entra con tu correo y contraseña.");
      await finish(accountEmail);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  if (existing) {
    return (
      <Card>
        <p className="text-sm text-muted-foreground">
          Ya tienes una cuenta con este correo. Entra con tu contraseña y crearás el negocio con este mismo enlace.
        </p>
        <Button asChild className="w-full">
          <Link to={loginWithCode}>Entrar para continuar</Link>
        </Button>
      </Card>
    );
  }

  return (
    <Card>
      <div className="space-y-1 text-center">
        <h1 className="text-lg font-semibold">Bienvenido a B Systems</h1>
        <p className="text-sm text-muted-foreground">Alta para {invite.label}. En un minuto tienes tu negocio listo.</p>
      </div>

      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="business">Nombre del negocio</Label>
          <Input id="business" required value={businessName} onChange={(e) => setBusinessName(e.target.value)} maxLength={80} />
        </div>

        {session ? (
          <p className="text-sm text-muted-foreground">
            Lo crearás con tu cuenta {session.user.email}.{" "}
            <button type="button" className="underline underline-offset-4" onClick={signOut}>
              Usar otra cuenta
            </button>
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="full-name">Tu nombre</Label>
              <Input id="full-name" autoComplete="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={80} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="signup-email">Correo</Label>
              <Input
                id="signup-email"
                type="email"
                autoComplete="email"
                required
                readOnly={Boolean(invite.email)}
                value={invite.email ?? email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@negocio.com"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="signup-password">Contraseña</Label>
                <Input
                  id="signup-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="signup-confirm">Repítela</Label>
                <Input
                  id="signup-confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Al menos 8 caracteres, con letras y números.</p>
          </>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Creando tu negocio…" : "Crear mi negocio"}
        </Button>
      </form>

      {!session && (
        <p className="text-center text-xs text-muted-foreground">
          ¿Ya tienes cuenta?{" "}
          <Link to={loginWithCode} className="underline underline-offset-4">
            Entra aquí
          </Link>
        </p>
      )}
    </Card>
  );
}
