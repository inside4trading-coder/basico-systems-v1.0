/**
 * «¿Dónde obtengo este archivo?»: pasos que el dueño o el administrador deja
 * escritos para el equipo. Sin pasos propios se muestran los de por defecto.
 */
import { useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useSaveImportGuide, type GuideKey, type ImportGuide as Guide } from "./api";

export default function ImportGuide({
  guideKey,
  guides,
  defaultSteps,
  canEdit,
  title = "¿Dónde obtenerlo?",
}: {
  guideKey: GuideKey;
  guides: Guide[];
  defaultSteps: string[];
  canEdit: boolean;
  title?: string;
}) {
  const custom = guides.find((g) => g.source_key === guideKey)?.steps ?? null;
  const steps = custom ? custom.split("\n").map((l) => l.trim()).filter(Boolean) : defaultSteps;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const save = useSaveImportGuide();

  const store = (value: string) =>
    save.mutate(
      { key: guideKey, steps: value },
      {
        onSuccess: () => {
          toast.success(value.trim() ? "Pasos guardados para el equipo" : "Se restauraron los pasos por defecto");
          setEditing(false);
        },
        onError: (err) => toast.error("No se pudo guardar", { description: err.message }),
      },
    );

  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold">{title}</p>
        {canEdit && !editing && (
          <Button
            size="sm"
            variant="ghost"
            aria-label="Editar los pasos"
            onClick={() => {
              setText(steps.join("\n"));
              setEditing(true);
            }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        )}
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <Textarea aria-label="Pasos, uno por línea" rows={6} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} />
          <p className="text-xs text-muted-foreground">Un paso por línea. Lo verá todo el equipo de administración.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={save.isPending || !text.trim()} onClick={() => store(text)}>
              Guardar
            </Button>
            {custom && (
              <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => store("")}>
                Restaurar por defecto
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-muted-foreground">
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
