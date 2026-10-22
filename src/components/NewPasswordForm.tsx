import { useState, type FormEvent } from "react";
import BrandMark from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { passwordProblem } from "@/core/password";
import { supabase } from "@/core/supabase";

interface Props {
  title: string;
  description: string;
  /** Datos extra del usuario que se guardan junto con la contraseña. */
  data?: Record<string, unknown>;
  onDone: () => void;
}

/** Pantalla para crear o cambiar la contraseña de la sesión actual. */
export default function NewPasswordForm({ title, description, data, onDone }: Props) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = passwordProblem(password, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError("");
    const { error: updateError } = await supabase.auth.updateUser({ password, ...(data ? { data } : {}) });
    setSaving(false);
    if (updateError) {
      setError(
        updateError.code === "same_password"
          ? "Elige una contraseña distinta a la anterior"
          : updateError.code === "weak_password"
            ? "Esa contraseña es muy débil: usa 8+ caracteres con letras y números"
            : "No se pudo guardar la contraseña. Intenta de nuevo.",
      );
      return;
    }
    onDone();
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-6 rounded-surface border bg-card p-8 shadow-sm">
        <div className="flex flex-col items-center gap-3 text-center">
          <BrandMark className="text-4xl" />
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-password">Contraseña nueva</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Al menos 8 caracteres, con letras y números.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm-password">Repite la contraseña</Label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={saving}>
          {saving ? "Guardando…" : "Guardar contraseña"}
        </Button>
      </form>
    </main>
  );
}
