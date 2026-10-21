/**
 * Escanear con la cámara del teléfono o la tablet. Lee el primer código que
 * vea, vibra y se cierra; quien lo abrió recibe el código como si lo hubiera
 * leído una pistola.
 */
import { useEffect, useRef, useState } from "react";
import { ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { normalizeScannedCode } from "./burst";
import { canUseCamera, createCodeDetector } from "./detector";

const SCAN_EVERY_MS = 200;

export function CameraScanner({
  open,
  onOpenChange,
  onScan,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (code: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const handler = useRef(onScan);
  handler.current = onScan;
  const close = useRef(onOpenChange);
  close.current = onOpenChange;
  const [status, setStatus] = useState<"starting" | "scanning" | "error">("starting");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    setStatus("starting");
    setError("");

    (async () => {
      try {
        const [detector, media] = await Promise.all([
          createCodeDetector(),
          navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }),
        ]);
        stream = media;
        if (cancelled || !videoRef.current) return;
        videoRef.current.srcObject = media;
        await videoRef.current.play();
        setStatus("scanning");
        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const found = videoRef.current.readyState >= 2 ? await detector.detect(videoRef.current) : [];
            const code = found.find((f) => f.rawValue.trim())?.rawValue;
            if (code && !cancelled) {
              cancelled = true;
              navigator.vibrate?.(80);
              handler.current(normalizeScannedCode(code));
              close.current(false);
              return;
            }
          } catch {
            // Un cuadro que no se pudo leer: se intenta con el siguiente.
          }
          timer = window.setTimeout(tick, SCAN_EVERY_MS);
        };
        tick();
      } catch (err) {
        if (cancelled) return;
        const name = (err as Error).name;
        setError(
          name === "NotAllowedError"
            ? "No hay permiso para usar la cámara. Actívalo en el navegador e inténtalo de nuevo."
            : name === "NotFoundError"
              ? "Este equipo no tiene cámara."
              : "No se pudo abrir la cámara.",
        );
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Escanear código</DialogTitle>
          <DialogDescription>Apunta la cámara al código de barras o QR.</DialogDescription>
        </DialogHeader>
        {status === "error" ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <div className="relative overflow-hidden rounded-lg bg-black">
            <video ref={videoRef} className="aspect-[4/3] w-full object-cover" muted playsInline />
            <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-primary/80" />
            {status === "starting" && (
              <p className="absolute inset-0 grid place-items-center text-sm text-white">Abriendo la cámara…</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Botón de cámara junto a un buscador; no aparece si el equipo no tiene cámara. */
export function ScanButton({
  onScan,
  className,
  label = "Escanear",
  showLabel = false,
}: {
  onScan: (code: string) => void;
  className?: string;
  label?: string;
  showLabel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!canUseCamera()) return null;
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={className}
        onClick={() => setOpen(true)}
        aria-label={label}
        title={label}
      >
        <ScanLine />
        {showLabel && <span>{label}</span>}
      </Button>
      <CameraScanner open={open} onOpenChange={setOpen} onScan={onScan} />
    </>
  );
}
