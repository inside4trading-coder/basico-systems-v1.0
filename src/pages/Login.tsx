import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import BrandMark from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/core/supabase";
import { useAuth } from "@/core/auth";

type Mode = "password" | "forgot" | "link";

const TITLES: Record<Mode, string> = {
  password: "Entrar",
  forgot: "Restablecer contraseña",
  link: "Entrar con enlace",
};

export default function Login() {
  const { session, loading } = useAuth();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  if (!loading && session) return <Navigate to="/" replace />;

  const switchMode = (next: Mode) => {
    setMode(next);
    setStatus("idle");
    setMessage("");
  };

  const fail = (text: string) => {
    setStatus("error");
    setMessage(text);
  };

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    setStatus("sending");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (!error) return;
    // Mismo mensaje exista o no la cuenta, para no revelar qué correos están registrados.
    if (error.status === 400 || error.code === "invalid_credentials") return fail("Correo o contraseña incorrectos.");
    if (error.status === 429) return fail("Demasiados intentos. Espera unos minutos.");
    fail("No se pudo entrar. Revisa tu conexión e intenta de nuevo.");
  };

  const sendReset = async (event: FormEvent) => {
    event.preventDefault();
    setStatus("sending");
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/restablecer`,
    });
    if (error && error.status === 429) return fail("Ya enviamos un correo hace poco. Espera unos minutos.");
    if (error && error.status !== 400 && error.status !== 422) return fail("No se pudo enviar el correo. Intenta en unos minutos.");
    setStatus("sent");
    setMessage("Si tu correo tiene acceso, te llegó un enlace para crear una contraseña nueva.");
  };

  const sendLink = async (event: FormEvent) => {
    event.preventDefault();
    setStatus("sending");
    // Solo cuentas existentes: el acceso es por invitación.
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
    });
    if (error && error.status !== 400 && error.status !== 422) return fail("No se pudo enviar el enlace. Intenta en unos minutos.");
    setStatus("sent");
    setMessage("Si tu correo tiene acceso, te llegó un enlace para entrar.");
  };

  const emailField = (
    <div className="space-y-1.5">
      <Label htmlFor="email">Correo</Label>
      <Input
        id="email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="tu@negocio.com"
      />
    </div>
  );

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6 rounded-surface border bg-card p-8 shadow-sm">
        <div className="flex flex-col items-center gap-3">
          <BrandMark className="text-4xl" />
          <p className="mono-cap text-xs text-muted-foreground">{TITLES[mode]}</p>
        </div>

        {mode === "password" && (
          <form onSubmit={signIn} className="space-y-3">
            {emailField}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Contraseña</Label>
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                  onClick={() => switchMode("forgot")}
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={status === "sending"}>
              {status === "sending" ? "Entrando…" : "Entrar"}
            </Button>
          </form>
        )}

        {mode === "forgot" && (
          <form onSubmit={sendReset} className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Te enviamos un enlace para crear una contraseña nueva. Sirve también si nunca creaste una.
            </p>
            {emailField}
            <Button type="submit" className="w-full" disabled={status === "sending" || status === "sent"}>
              {status === "sending" ? "Enviando…" : "Enviarme el enlace"}
            </Button>
          </form>
        )}

        {mode === "link" && (
          <form onSubmit={sendLink} className="space-y-3">
            {emailField}
            <Button type="submit" className="w-full" disabled={status === "sending" || status === "sent"}>
              {status === "sending" ? "Enviando…" : "Enviarme un enlace"}
            </Button>
          </form>
        )}

        {message && (
          <p role="status" className={status === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
            {message}
          </p>
        )}

        <div className="space-y-2 text-center text-xs text-muted-foreground">
          {mode === "password" ? (
            <button type="button" className="underline-offset-4 hover:underline" onClick={() => switchMode("link")}>
              Entrar con un enlace a mi correo
            </button>
          ) : (
            <button type="button" className="underline-offset-4 hover:underline" onClick={() => switchMode("password")}>
              Volver a entrar con contraseña
            </button>
          )}
          <p>El acceso es por invitación del administrador de tu negocio.</p>
        </div>
      </div>
    </main>
  );
}
