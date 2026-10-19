import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import BrandMark from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/core/supabase";
import { useAuth } from "@/core/auth";

export default function Login() {
  const { session, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  if (!loading && session) return <Navigate to="/" replace />;

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      setStatus("error");
      setMessage("No se pudo abrir Google. Intenta de nuevo.");
    }
  };

  const sendLink = async (event: FormEvent) => {
    event.preventDefault();
    setStatus("sending");
    // Solo cuentas existentes: el acceso es por invitación.
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
    });
    // Mismo mensaje exista o no la cuenta, para no revelar qué correos están registrados.
    if (error && error.status !== 400 && error.status !== 422) {
      setStatus("error");
      setMessage("No se pudo enviar el enlace. Intenta en unos minutos.");
      return;
    }
    setStatus("sent");
    setMessage("Si tu correo tiene acceso, te llegó un enlace para entrar.");
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-8 rounded-surface border bg-card p-8 shadow-sm">
        <div className="flex flex-col items-center gap-3">
          <BrandMark className="text-4xl" />
          <p className="mono-cap text-xs text-muted-foreground">Entrar</p>
        </div>

        <Button type="button" className="w-full" onClick={signInWithGoogle}>
          Continuar con Google
        </Button>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />o con tu correo<span className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={sendLink} className="space-y-3">
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
          <Button type="submit" variant="outline" className="w-full" disabled={status === "sending"}>
            {status === "sending" ? "Enviando…" : "Enviarme un enlace"}
          </Button>
        </form>

        {message && (
          <p role="status" className={status === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
            {message}
          </p>
        )}

        <p className="text-center text-xs text-muted-foreground">
          El acceso es por invitación del administrador de tu negocio.
        </p>
      </div>
    </main>
  );
}
