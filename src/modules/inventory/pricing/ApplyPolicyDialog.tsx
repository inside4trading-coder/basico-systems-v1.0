/**
 * Aplicar la política a todo el inventario: primero muestra cuántos precios
 * cambian (suben, bajan), cuántos no se tocan por ser manuales y cuántos no
 * tienen costo; después aplica en el servidor, de una vez.
 */
import { useEffect } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useApplyPolicy } from "./api";

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("es-VE")} ${n === 1 ? one : many}`;

export default function ApplyPolicyDialog({ open, onOpenChange, title = "Aplicar la política a todo el inventario" }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
}) {
  const preview = useApplyPolicy();
  const apply = useApplyPolicy();
  const { mutate: runPreview, reset: resetPreview } = preview;

  useEffect(() => {
    if (open) runPreview(true);
    else resetPreview();
  }, [open, runPreview, resetPreview]);

  const impact = preview.data;
  const submit = () =>
    apply.mutate(false, {
      onSuccess: (r) => {
        toast.success(r.applied ? `${plural(r.applied, "precio actualizado", "precios actualizados")} con la política` : "Los precios ya estaban al día");
        onOpenChange(false);
      },
      onError: (err) => toast.error("No se pudo aplicar", { description: err.message }),
    });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            El precio de cada producto con costo pasa a ser el de la política. Las ofertas más bajas se mantienen y todo queda en el
            historial.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {preview.isPending && <p className="mono-cap text-xs text-muted-foreground">Calculando…</p>}
        {preview.isError && <p className="text-sm text-destructive">{preview.error.message}</p>}
        {impact && (
          <ul className="space-y-1 text-sm">
            <li className="text-base font-semibold">
              {impact.changed === 0 ? "Ningún precio cambia: ya están con la política." : `${plural(impact.changed, "precio cambia", "precios cambian")}`}
            </li>
            {impact.changed > 0 && (
              <li className="text-muted-foreground">
                {plural(impact.up, "sube", "suben")} · {plural(impact.down, "baja", "bajan")}
              </li>
            )}
            {impact.same > 0 && <li className="text-muted-foreground">{plural(impact.same, "ya está al día", "ya están al día")}</li>}
            {impact.locked > 0 && (
              <li className="text-muted-foreground">{plural(impact.locked, "con precio manual no se toca", "con precio manual no se tocan")}</li>
            )}
            {impact.no_cost > 0 && (
              <li className="text-muted-foreground">
                {plural(impact.no_cost, "sin costo no cambia", "sin costo no cambian")}: carga el costo para que la política los alcance.
              </li>
            )}
          </ul>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Ahora no</AlertDialogCancel>
          <Button onClick={submit} disabled={!impact || apply.isPending}>
            {impact && impact.changed > 0 ? `Aplicar a ${plural(impact.changed, "producto", "productos")}` : "Aplicar"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
