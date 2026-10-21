/**
 * Estudio de IA (add-on): fotos de producto a partir de una foto tomada con
 * el teléfono. Portado de EstudioVisual.tsx (basicosystems@f551478b), sin
 * rubro y en tres pasos: producto, foto, tipo de foto.
 */
import { useEffect, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Camera, Sparkles } from "lucide-react";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";
import { canEditCatalog } from "@/core/tenant-selection";
import { cn } from "@/lib/utils";
import { VariantFinder } from "@/modules/inventory/components";
import {
  KIND_INFO,
  SCENE_IDEAS,
  publicUrlOf,
  useApplyResult,
  useGenerate,
  useStudioJobs,
  useStudioUsage,
  type StudioKind,
} from "./api";

/** Cuadriculado para ver la transparencia. */
const CHECKER =
  "bg-[conic-gradient(#e5e7eb_25%,transparent_0_50%,#e5e7eb_0_75%,transparent_0)] bg-[length:16px_16px]";

function useProduct(productId: string | null) {
  return useQuery({
    enabled: Boolean(productId),
    queryKey: ["studio", "product", productId],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("id, name, brand, image_url").eq("id", productId).single();
      if (error) throw new Error(error.message);
      return data as { id: string; name: string; brand: string | null; image_url: string | null };
    },
  });
}

export default function StudioPage() {
  const { active } = useTenant();
  const [params] = useSearchParams();
  const [productId, setProductId] = useState<string | null>(params.get("producto"));
  const { data: product } = useProduct(productId);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [kind, setKind] = useState<StudioKind>("catalogo");
  const [scene, setScene] = useState("");
  const [result, setResult] = useState<{ url: string; kind: StudioKind } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: usage } = useStudioUsage();
  const { data: jobs = [] } = useStudioJobs();
  const generate = useGenerate();
  const apply = useApplyResult();

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (!canEditCatalog(active?.role)) return <Navigate to="/" replace />;

  const left = usage ? Math.max(0, usage.limit - usage.used) : 0;
  const source = preview ?? product?.image_url ?? null;
  const canGenerate = Boolean(product && source && left > 0 && (kind !== "ambientado" || scene.trim()) && !generate.isPending);

  const run = () => {
    if (!product) return;
    setResult(null);
    generate.mutate(
      { productId: product.id, kind, scene: kind === "ambientado" ? scene.trim() : null, file, currentUrl: product.image_url },
      {
        onSuccess: (r) => setResult({ url: r.url, kind: r.kind }),
        onError: (err) => toast.error("No se generó la foto", { description: err.message }),
      },
    );
  };

  const useAsPhoto = () => {
    if (!product || !result) return;
    apply.mutate(
      { productId: product.id, resultUrl: result.url, kind: result.kind, previousUrl: product.image_url },
      {
        onSuccess: () => toast.success("Listo: es la foto del producto en Inventario y en el POS"),
        onError: (err) => toast.error("No se pudo poner la foto", { description: err.message }),
      },
    );
  };

  return (
    <AppShell wide>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl">Estudio de IA</h1>
          <p className="text-sm text-muted-foreground">Fotos de producto listas para el catálogo, desde una foto tomada con el teléfono.</p>
        </div>
        {usage && (
          <Badge variant={left > 0 ? "secondary" : "outline"} className="num">
            {usage.used} de {usage.limit} fotos este mes
          </Badge>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card className="space-y-4 p-4">
          <section className="space-y-2">
            <p className="mono-cap text-xs text-muted-foreground">1 · Producto</p>
            {product ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border p-2">
                <p className="font-semibold">
                  {product.name}
                  {product.brand && <span className="ml-2 text-xs text-muted-foreground">{product.brand}</span>}
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setProductId(null);
                    setFile(null);
                    setResult(null);
                  }}
                >
                  Cambiar
                </Button>
              </div>
            ) : (
              <VariantFinder onPick={(found) => found && setProductId(found.product_id)} autoFocus />
            )}
          </section>

          <section className="space-y-2">
            <p className="mono-cap text-xs text-muted-foreground">2 · Foto del producto</p>
            <p className="text-xs text-muted-foreground">
              Una foto clara, de frente y bien iluminada. No importa el fondo: la IA lo quita.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <div className="grid h-28 w-28 place-items-center overflow-hidden rounded-lg border bg-muted">
                {source ? <img src={source} alt="Foto de origen" className="h-full w-full object-cover" /> : <Camera className="h-6 w-6 text-muted-foreground" />}
              </div>
              <div className="space-y-1">
                <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={!product}>
                  <Camera /> {file ? "Otra foto" : "Tomar o elegir foto"}
                </Button>
                {!file && product?.image_url && <p className="text-xs text-muted-foreground">Si no eliges otra, se usa la foto actual.</p>}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  e.target.value = "";
                }}
              />
            </div>
          </section>

          <section className="space-y-2">
            <p className="mono-cap text-xs text-muted-foreground">3 · Tipo de foto</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {(Object.keys(KIND_INFO) as StudioKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={kind === k}
                  onClick={() => setKind(k)}
                  className={cn("rounded-lg border p-3 text-left", kind === k ? "border-primary bg-primary/5" : "bg-card hover:border-primary")}
                >
                  <p className="text-sm font-semibold">{KIND_INFO[k].title}</p>
                  <p className="text-xs text-muted-foreground">{KIND_INFO[k].description}</p>
                </button>
              ))}
            </div>
            {kind === "ambientado" && (
              <div className="space-y-2">
                <Input value={scene} maxLength={300} onChange={(e) => setScene(e.target.value)} placeholder="¿Dónde va el producto? Ej.: sobre una mesa de madera clara" aria-label="Ambiente" />
                <div className="flex flex-wrap gap-1">
                  {SCENE_IDEAS.map((idea) => (
                    <button key={idea} type="button" onClick={() => setScene(idea)} className="rounded-full border px-2 py-0.5 text-xs hover:border-primary">
                      {idea}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {kind === "transparente" && (
              <p className="text-xs text-muted-foreground">Si el producto es verde intenso, revisa el resultado: el recorte usa el verde del fondo.</p>
            )}
          </section>

          <Button className="w-full" size="lg" disabled={!canGenerate} onClick={run}>
            <Sparkles /> {generate.isPending ? "Generando… (puede tardar un minuto)" : "Generar foto"}
          </Button>
          {usage && left === 0 && <p className="text-xs text-destructive">Ya usaste las fotos de este mes. Escríbenos para ampliar el plan.</p>}
        </Card>

        <Card className="space-y-3 p-4">
          <p className="mono-cap text-xs text-muted-foreground">Resultado</p>
          {result ? (
            <>
              <ResultImage url={result.url} kind={result.kind} />
              <div className="flex flex-wrap gap-2">
                <Button onClick={useAsPhoto} disabled={apply.isPending}>
                  {apply.isPending ? "Guardando…" : "Usar como foto del producto"}
                </Button>
                <Button variant="outline" onClick={run} disabled={!canGenerate}>
                  Generar otra
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {generate.isPending ? "La IA está trabajando en la foto…" : "Aquí aparece la foto generada. Puedes comparar y generar otra antes de usarla."}
            </p>
          )}
        </Card>
      </div>

      {jobs.length > 0 && (
        <section className="space-y-2">
          <p className="mono-cap text-xs text-muted-foreground">Generadas recientemente</p>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {jobs.map((j) => (
              <li key={j.id} className="overflow-hidden rounded-lg border bg-card">
                <div className={cn("grid aspect-square place-items-center bg-muted", j.kind === "transparente" && CHECKER)}>
                  {j.status === "listo" && j.result_path ? (
                    <button
                      type="button"
                      className="h-full w-full"
                      onClick={() => {
                        setProductId(j.product_id);
                        setResult({ url: publicUrlOf(j.result_path!), kind: j.kind });
                      }}
                      title="Ver y usar"
                    >
                      <img src={publicUrlOf(j.result_path)} alt="" loading="lazy" className="h-full w-full object-cover" />
                    </button>
                  ) : (
                    <span className="p-2 text-center text-xs text-muted-foreground">{j.status === "fallido" ? "Falló (no gastó cuota)" : "Generando…"}</span>
                  )}
                </div>
                <p className="truncate px-2 py-1 text-xs">
                  {j.products?.name ?? "Producto"} · {KIND_INFO[j.kind].title}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </AppShell>
  );
}

/** El transparente se muestra ya recortado sobre cuadriculado para juzgarlo antes de usarlo. */
function ResultImage({ url, kind }: { url: string; kind: StudioKind }) {
  const [shown, setShown] = useState<string>(url);
  useEffect(() => {
    if (kind !== "transparente") return setShown(url);
    let revoke: string | null = null;
    let cancelled = false;
    (async () => {
      const { transparentPng } = await import("./chroma");
      const blob = await transparentPng(await (await fetch(url)).blob());
      if (cancelled) return;
      revoke = URL.createObjectURL(blob);
      setShown(revoke);
    })().catch(() => setShown(url));
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [url, kind]);
  return (
    <div className={cn("overflow-hidden rounded-lg border", kind === "transparente" ? CHECKER : "bg-muted")}>
      <img src={shown} alt="Foto generada" className="mx-auto max-h-[480px] w-full object-contain" />
    </div>
  );
}
