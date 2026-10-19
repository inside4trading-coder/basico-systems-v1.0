import { toast } from "sonner";

export const ACCEPTED_PROOFS = "image/jpeg,image/png,image/webp,image/heic,application/pdf";
const MAX_PROOF_BYTES = 10 * 1024 * 1024;

/** Archivos válidos para comprobante (imagen o PDF de hasta 10 MB); avisa los que no. */
export function pickProofs(list: FileList | null): File[] {
  const files = Array.from(list ?? []);
  const ok = files.filter((f) => ACCEPTED_PROOFS.split(",").includes(f.type) && f.size <= MAX_PROOF_BYTES);
  if (ok.length < files.length) toast.error("Solo imágenes o PDF de hasta 10 MB");
  return ok;
}
