/**
 * Miniatura de la foto del producto en Inventario. Quien edita el catálogo la
 * toca para subir una foto (en el teléfono abre la cámara), cambiarla o
 * quitarla.
 */
import { useRef, useState } from "react";
import { Camera, Package } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useProductPhoto } from "./photos";

export function ProductThumb({ url, className = "h-10 w-10" }: { url: string | null; className?: string }) {
  return url ? (
    <img src={url} alt="" loading="lazy" className={`${className} shrink-0 rounded-md border object-cover`} />
  ) : (
    <span className={`${className} grid shrink-0 place-items-center rounded-md border bg-muted`}>
      <Package className="h-4 w-4 text-muted-foreground/60" aria-hidden />
    </span>
  );
}

export function ProductPhotoButton({
  productId,
  productName,
  url,
  editable,
}: {
  productId: string;
  productName: string;
  url: string | null;
  editable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { upload, remove } = useProductPhoto();
  const busy = upload.isPending || remove.isPending;

  if (!editable) return <ProductThumb url={url} />;

  const onFile = (file: File | undefined) => {
    if (!file) return;
    upload.mutate(
      { productId, file, previousUrl: url },
      {
        onSuccess: () => {
          toast.success("Foto guardada");
          setOpen(false);
        },
        onError: (err) => toast.error("No se pudo guardar la foto", { description: err.message }),
      },
    );
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`Foto de ${productName}`} title="Foto del producto" className="rounded-md hover:opacity-80">
        <ProductThumb url={url} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Foto del producto</DialogTitle>
            <DialogDescription>{productName}</DialogDescription>
          </DialogHeader>
          <div className="grid aspect-square w-full place-items-center overflow-hidden rounded-lg border bg-muted">
            {url ? <img src={url} alt={productName} className="h-full w-full object-contain" /> : <Package className="h-10 w-10 text-muted-foreground/60" />}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <div className="flex gap-2">
            <Button className="flex-1" disabled={busy} onClick={() => fileRef.current?.click()}>
              <Camera /> {upload.isPending ? "Subiendo…" : url ? "Cambiar foto" : "Subir foto"}
            </Button>
            {url && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  remove.mutate(
                    { productId, previousUrl: url },
                    {
                      onSuccess: () => setOpen(false),
                      onError: (err) => toast.error("No se pudo quitar la foto", { description: err.message }),
                    },
                  )
                }
              >
                Quitar
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Se achica a 800 px antes de subir para que cargue rápido en el POS.</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
