/**
 * Estudio de IA (add-on), como Basico Studio del ERP (basicosystems@9cb08cd)
 * y sin rubro: tarjetas de acción, asistente por pasos (producto, fotos y
 * notas, fondo o escena, formato y cuántas imágenes), galería con filtros y
 * visor, y configuración del negocio (prompts, marca, producto con persona).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Camera, Download, Film, ImagePlus, Settings2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";
import { canEditCatalog, canManageTeam } from "@/core/tenant-selection";
import { cn } from "@/lib/utils";
import { VariantFinder } from "@/modules/inventory/components";
import {
  DEFAULT_SETTINGS,
  EXTRA_VIEWS,
  FORMAT_ASPECT,
  FORMAT_OPTIONS,
  KIND_INFO,
  SCENE_IDEAS,
  publicUrlOf,
  useApplyResult,
  useGenerate,
  useSaveStudioSettings,
  useStudioJobs,
  useStudioSettings,
  useStudioUsage,
  type GeneratedImage,
  type StudioFormat,
  type StudioJob,
  type StudioKind,
  type StudioSettings,
} from "./api";

/** Cuadriculado para ver la transparencia. */
const CHECKER = "bg-[conic-gradient(#e5e7eb_25%,transparent_0_50%,#e5e7eb_0_75%,transparent_0)] bg-[length:16px_16px]";

const PEOPLE_IDEAS = [
  "persona adulta sonriendo, en una cocina luminosa",
  "persona joven al aire libre, luz de tarde",
  "manos sosteniendo el producto sobre una mesa",
  "persona en una oficina moderna, estilo natural",
];

type Filter = "todos" | "listo" | "pendiente" | "fallido";
const FILTER_LABEL: Record<Filter, string> = { todos: "Todos", listo: "Listos", pendiente: "Procesando", fallido: "Fallidos" };

interface Product {
  id: string;
  name: string;
  brand: string | null;
  image_url: string | null;
}

function useProduct(productId: string | null) {
  return useQuery({
    enabled: Boolean(productId),
    queryKey: ["studio", "product", productId],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("id, name, brand, image_url").eq("id", productId).single();
      if (error) throw new Error(error.message);
      return data as Product;
    },
  });
}

/** Descarga la imagen con un nombre ordenado. */
async function download(url: string, name: string) {
  try {
    const blob = await (await fetch(url)).blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = name;
    a.click();
    URL.revokeObjectURL(href);
  } catch {
    window.open(url, "_blank", "noopener");
  }
}

const fileNameOf = (product: string, kind: StudioKind, n: number) =>
  `${product.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase()}-${kind}-${n}.png`;

export default function StudioPage() {
  const { active } = useTenant();
  const [params] = useSearchParams();
  const { data: usage } = useStudioUsage();
  const { data: jobs = [] } = useStudioJobs();
  const { data: settings = DEFAULT_SETTINGS } = useStudioSettings();
  const [wizard, setWizard] = useState<StudioKind | null>(params.get("producto") ? "catalogo" : null);
  const [config, setConfig] = useState(false);
  const [viewer, setViewer] = useState<StudioJob | null>(null);
  const [filter, setFilter] = useState<Filter>("todos");
  const [query, setQuery] = useState("");

  if (!canEditCatalog(active?.role)) return <Navigate to="/" replace />;

  const left = usage ? Math.max(0, usage.limit - usage.used) : 0;
  const kinds = (Object.keys(KIND_INFO) as StudioKind[]).filter((k) => k !== "persona" || settings.people_enabled);
  const needle = query.trim().toLowerCase();
  const shown = jobs.filter((j) => (filter === "todos" || j.status === filter) && (!needle || (j.products?.name ?? "").toLowerCase().includes(needle) || KIND_INFO[j.kind].title.toLowerCase().includes(needle)));
  const counts = (f: Filter) => (f === "todos" ? jobs.length : jobs.filter((j) => j.status === f).length);

  return (
    <AppShell wide>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-primary/10">
            <Sparkles className="h-5 w-5 text-primary" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl">Estudio IA</h1>
            <p className="text-sm text-muted-foreground">Fotos de producto para catálogo, redes y campañas, desde una foto tomada con el teléfono.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {usage && (
            <Badge variant={left > 0 ? "secondary" : "outline"} className="num">
              {usage.used} de {usage.limit} imágenes este mes
            </Badge>
          )}
          {canManageTeam(active?.role) && (
            <Button variant="outline" size="sm" onClick={() => setConfig(true)}>
              <Settings2 className="h-4 w-4" /> Configuración
            </Button>
          )}
        </div>
      </div>

      <section aria-label="¿Qué quieres crear?" className="space-y-2">
        <p className="mono-cap text-xs text-muted-foreground">¿Qué quieres crear?</p>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {kinds.map((k) => (
            <li key={k}>
              <button
                type="button"
                disabled={left === 0}
                onClick={() => setWizard(k)}
                className="flex h-full w-full flex-col gap-2 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary disabled:opacity-50"
              >
                <KindIcon kind={k} />
                <span className="font-semibold">{KIND_INFO[k].title}</span>
                <span className="text-xs text-muted-foreground">{KIND_INFO[k].description}</span>
              </button>
            </li>
          ))}
          <li>
            <div className="flex h-full flex-col gap-2 rounded-xl border border-dashed bg-card p-4 opacity-60">
              <Film className="h-5 w-5 text-muted-foreground" aria-hidden />
              <span className="font-semibold">Video corto</span>
              <span className="text-xs text-muted-foreground">Videos de producto para reels y campañas. Próximamente.</span>
            </div>
          </li>
        </ul>
        {usage && left === 0 && <p className="text-xs text-destructive">Ya usaste las imágenes de este mes. Escríbenos para ampliar el plan.</p>}
      </section>

      <section aria-label="Resultados" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="mono-cap mr-2 text-xs text-muted-foreground">Resultados</p>
          {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
            <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
              {FILTER_LABEL[f]} ({counts(f)})
            </Button>
          ))}
          <Input
            type="search"
            aria-label="Buscar resultados"
            placeholder="Buscar por producto o tipo…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 min-w-0 flex-1 basis-48"
          />
        </div>
        {shown.length === 0 && <p className="text-sm text-muted-foreground">{jobs.length === 0 ? "Aún no hay imágenes. Elige qué quieres crear arriba." : "Nada en este filtro."}</p>}
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {shown.map((j) => (
            <li key={j.id} className="overflow-hidden rounded-xl border bg-card">
              <button
                type="button"
                disabled={j.status !== "listo"}
                onClick={() => setViewer(j)}
                className={cn("grid w-full place-items-center bg-muted", FORMAT_ASPECT[j.format] ?? "aspect-square", j.kind === "transparente" && CHECKER)}
                title={j.status === "listo" ? "Ver" : undefined}
              >
                {j.status === "listo" && j.result_path ? (
                  <img src={publicUrlOf(j.result_path)} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <span className="p-2 text-center text-xs text-muted-foreground">{j.status === "fallido" ? "Falló (no gastó cuota)" : "Generando…"}</span>
                )}
              </button>
              <div className="space-y-0.5 px-2 py-1.5">
                <p className="truncate text-xs font-semibold">{j.products?.name ?? "Producto"}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {KIND_INFO[j.kind].title} · {j.format}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {wizard && <Wizard initialKind={wizard} kinds={kinds} left={left} initialProduct={params.get("producto")} onClose={() => setWizard(null)} />}
      {config && <ConfigDialog settings={settings} onClose={() => setConfig(false)} />}
      {viewer && <Viewer job={viewer} onClose={() => setViewer(null)} />}
    </AppShell>
  );
}

function KindIcon({ kind }: { kind: StudioKind }) {
  return (
    <span className={cn("grid h-9 w-9 place-items-center rounded-lg", kind === "transparente" ? CHECKER : "bg-primary/10")}>
      <Sparkles className="h-4 w-4 text-primary" aria-hidden />
    </span>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{n}</span>
        <h3 className="font-semibold">{title}</h3>
      </div>
      <div className="space-y-2 pl-8">{children}</div>
    </section>
  );
}

function PhotoSlot({ label, file, fallback, onFile, onClear }: { label: string; file: File | null; fallback?: string | null; onFile: (f: File) => void; onClear?: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const src = preview ?? fallback ?? null;
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="relative">
        <button type="button" onClick={() => ref.current?.click()} className="grid h-24 w-24 place-items-center overflow-hidden rounded-lg border bg-muted hover:border-primary">
          {src ? <img src={src} alt={label} className="h-full w-full object-cover" /> : <ImagePlus className="h-5 w-5 text-muted-foreground" />}
        </button>
        {file && onClear && (
          <button type="button" aria-label={`Quitar ${label}`} onClick={onClear} className="absolute -right-2 -top-2 grid h-5 w-5 place-items-center rounded-full bg-secondary">
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function Wizard({ initialKind, kinds, left, initialProduct, onClose }: { initialKind: StudioKind; kinds: StudioKind[]; left: number; initialProduct: string | null; onClose: () => void }) {
  const [kind, setKind] = useState<StudioKind>(initialKind);
  const [productId, setProductId] = useState<string | null>(initialProduct);
  const { data: product } = useProduct(productId);
  const [main, setMain] = useState<File | null>(null);
  const [extras, setExtras] = useState<(File | null)[]>([null, null, null]);
  const [notes, setNotes] = useState("");
  const [scene, setScene] = useState("");
  const [format, setFormat] = useState<StudioFormat>(initialKind === "ambientado" ? "4:5" : "1:1");
  const [outputs, setOutputs] = useState(1);
  const [done, setDone] = useState<{ images: GeneratedImage[]; failed: number; firstError: string | null } | null>(null);
  const generate = useGenerate();
  const apply = useApplyResult();

  const hasSource = Boolean(main || product?.image_url);
  const needsScene = kind === "ambientado";
  const maxOutputs = Math.max(1, Math.min(4, left));
  const canGenerate = Boolean(product && hasSource && left > 0 && (!needsScene || scene.trim()) && !generate.isPending);

  const run = () => {
    if (!product) return;
    generate.mutate(
      {
        productId: product.id,
        kind,
        scene: kind === "ambientado" || kind === "persona" ? scene.trim() || null : null,
        file: main,
        currentUrl: product.image_url,
        extraFiles: extras.filter((f): f is File => Boolean(f)),
        notes: notes.trim() || null,
        format,
        outputs: Math.min(outputs, maxOutputs),
      },
      {
        onSuccess: (r) => {
          setDone(r);
          if (r.failed) toast.warning(`${r.failed} de ${r.images.length + r.failed} imágenes fallaron (no gastan cuota)`, { description: r.firstError ?? undefined });
        },
        onError: (err) => toast.error("No se generó", { description: err.message }),
      },
    );
  };

  const setAsPhoto = (img: GeneratedImage) => {
    if (!product) return;
    apply.mutate(
      { productId: product.id, resultUrl: img.url, kind: img.kind, previousUrl: product.image_url },
      {
        onSuccess: () => toast.success("Listo: es la foto del producto en Inventario y en el POS"),
        onError: (err) => toast.error("No se pudo poner la foto", { description: err.message }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(v) => !v && !generate.isPending && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{KIND_INFO[kind].title}</DialogTitle>
          <DialogDescription>{KIND_INFO[kind].description}</DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-3">
            <div className={cn("grid gap-3", done.images.length > 1 ? "sm:grid-cols-2" : "")}>
              {done.images.map((img, i) => (
                <div key={img.jobId} className="space-y-2">
                  <ResultImage url={img.url} kind={img.kind} format={img.format} />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => setAsPhoto(img)} disabled={apply.isPending}>
                      Usar como foto del producto
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => download(img.url, fileNameOf(product?.name ?? "producto", img.kind, i + 1))}>
                      <Download className="h-4 w-4" /> Descargar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setDone(null)}>
                Generar otra variante
              </Button>
              <Button variant="ghost" onClick={onClose}>
                Cerrar
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <Step n={1} title="Tipo">
              <div className="flex flex-wrap gap-1">
                {kinds.map((k) => (
                  <Button key={k} size="sm" variant={kind === k ? "default" : "outline"} onClick={() => setKind(k)}>
                    {KIND_INFO[k].title}
                  </Button>
                ))}
              </div>
            </Step>

            <Step n={2} title="Producto">
              {product ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border p-2">
                  <p className="font-semibold">
                    {product.name}
                    {product.brand && <span className="ml-2 text-xs text-muted-foreground">{product.brand}</span>}
                  </p>
                  <Button size="sm" variant="ghost" onClick={() => setProductId(null)}>
                    Cambiar
                  </Button>
                </div>
              ) : (
                <VariantFinder onPick={(found) => found && setProductId(found.product_id)} autoFocus />
              )}
            </Step>

            <Step n={3} title="Fotos del producto">
              <p className="text-xs text-muted-foreground">
                La principal es obligatoria (si no eliges otra, se usa la foto actual). Las extra ayudan a respetar cada detalle. No importa el fondo: la IA lo quita.
              </p>
              <div className="flex flex-wrap gap-3">
                <PhotoSlot label="Principal (frente)" file={main} fallback={product?.image_url} onFile={setMain} onClear={() => setMain(null)} />
                {EXTRA_VIEWS.map((v, i) => (
                  <PhotoSlot
                    key={v.key}
                    label={`${v.label} (opcional)`}
                    file={extras[i]}
                    onFile={(f) => setExtras((prev) => prev.map((x, j) => (j === i ? f : x)))}
                    onClear={() => setExtras((prev) => prev.map((x, j) => (j === i ? null : x)))}
                  />
                ))}
              </div>
              <div className="space-y-1">
                <Label htmlFor="st-notes" className="text-xs">
                  Detalles que deben verse tal cual (opcional)
                </Label>
                <Textarea id="st-notes" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej.: logo bordado en el lado izquierdo, botones dorados, etiqueta azul" />
              </div>
            </Step>

            {(kind === "ambientado" || kind === "persona") && (
              <Step n={4} title={kind === "ambientado" ? "Escena" : "Persona y escena"}>
                <Input
                  value={scene}
                  maxLength={300}
                  onChange={(e) => setScene(e.target.value)}
                  placeholder={kind === "ambientado" ? "¿Dónde va el producto? Ej.: sobre una mesa de madera clara" : "Opcional. Ej.: persona adulta sonriendo en una cocina luminosa"}
                  aria-label="Escena"
                />
                <div className="flex flex-wrap gap-1">
                  {(kind === "ambientado" ? SCENE_IDEAS : PEOPLE_IDEAS).map((idea) => (
                    <button key={idea} type="button" onClick={() => setScene(idea)} className="rounded-full border px-2 py-0.5 text-xs hover:border-primary">
                      {idea}
                    </button>
                  ))}
                </div>
              </Step>
            )}
            {kind === "transparente" && <p className="pl-8 text-xs text-muted-foreground">Si el producto es verde intenso, revisa el resultado: el recorte usa un fondo verde.</p>}

            <Step n={kind === "ambientado" || kind === "persona" ? 5 : 4} title="Formato">
              <div className="flex flex-wrap gap-1">
                {FORMAT_OPTIONS.map((f) => (
                  <Button key={f.value} size="sm" variant={format === f.value ? "default" : "outline"} onClick={() => setFormat(f.value)}>
                    {f.label}
                  </Button>
                ))}
              </div>
            </Step>

            <Step n={kind === "ambientado" || kind === "persona" ? 6 : 5} title="Generar">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm">Cantidad de imágenes:</span>
                {[1, 2, 3, 4].map((n) => (
                  <Button key={n} size="sm" variant={outputs === n ? "default" : "outline"} disabled={n > maxOutputs} onClick={() => setOutputs(n)}>
                    {n}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Gasta {Math.min(outputs, maxOutputs)} de las {left} imágenes que te quedan este mes. Las que fallan no cuentan.
              </p>
              <Button className="w-full" size="lg" disabled={!canGenerate} onClick={run}>
                <Sparkles /> {generate.isPending ? "Generando… (puede tardar un minuto)" : "Generar"}
              </Button>
            </Step>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** El transparente se muestra ya recortado sobre cuadriculado para juzgarlo antes de usarlo. */
function ResultImage({ url, kind, format }: { url: string; kind: StudioKind; format: StudioFormat }) {
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
    <div className={cn("overflow-hidden rounded-lg border", FORMAT_ASPECT[format], kind === "transparente" ? CHECKER : "bg-muted")}>
      <img src={shown} alt="Imagen generada" className="h-full w-full object-contain" />
    </div>
  );
}

function Viewer({ job, onClose }: { job: StudioJob; onClose: () => void }) {
  const url = job.result_path ? publicUrlOf(job.result_path) : "";
  const { data: product } = useProduct(job.product_id);
  const apply = useApplyResult();
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{job.products?.name ?? "Producto"}</DialogTitle>
          <DialogDescription>
            {KIND_INFO[job.kind].title} · {job.format}
            {job.scene ? ` · ${job.scene}` : ""}
          </DialogDescription>
        </DialogHeader>
        <ResultImage url={url} kind={job.kind} format={job.format} />
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={apply.isPending || !product}
            onClick={() =>
              product &&
              apply.mutate(
                { productId: product.id, resultUrl: url, kind: job.kind, previousUrl: product.image_url },
                {
                  onSuccess: () => toast.success("Listo: es la foto del producto en Inventario y en el POS"),
                  onError: (err) => toast.error("No se pudo poner la foto", { description: err.message }),
                },
              )
            }
          >
            Usar como foto del producto
          </Button>
          <Button variant="outline" onClick={() => download(url, fileNameOf(job.products?.name ?? "producto", job.kind, 1))}>
            <Download className="h-4 w-4" /> Descargar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ConfigDialog({ settings, onClose }: { settings: StudioSettings; onClose: () => void }) {
  const save = useSaveStudioSettings();
  const [draft, setDraft] = useState<StudioSettings>(settings);
  const kinds = useMemo(() => Object.keys(KIND_INFO) as StudioKind[], []);
  const submit = () =>
    save.mutate(
      { ...draft, brand_name: draft.brand_name?.trim() || null, prompts: Object.fromEntries(Object.entries(draft.prompts).filter(([, v]) => v?.trim())) },
      {
        onSuccess: () => {
          toast.success("Configuración del Estudio guardada");
          onClose();
        },
        onError: (err) => toast.error("No se pudo guardar", { description: err.message }),
      },
    );
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Configuración del Estudio</DialogTitle>
          <DialogDescription>Lo que aplica a todas las imágenes de este negocio.</DialogDescription>
        </DialogHeader>
        <section className="space-y-2">
          <h3 className="font-semibold">Opciones</h3>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={draft.people_enabled} onCheckedChange={(v) => setDraft((d) => ({ ...d, people_enabled: v }))} />
            Producto con persona (una persona generada con IA usando el producto)
          </label>
        </section>
        <section className="space-y-2">
          <h3 className="font-semibold">Marca</h3>
          <p className="text-xs text-muted-foreground">Los colores se usan como acentos en las escenas y en las fotos con persona.</p>
          <Input aria-label="Nombre de la marca" placeholder="Nombre de la marca (opcional)" maxLength={60} value={draft.brand_name ?? ""} onChange={(e) => setDraft((d) => ({ ...d, brand_name: e.target.value }))} />
          <div className="flex flex-wrap items-center gap-2">
            {draft.brand_colors.map((c, i) => (
              <span key={i} className="flex items-center gap-1 rounded-lg border p-1">
                <input
                  type="color"
                  aria-label={`Color ${i + 1}`}
                  value={c}
                  onChange={(e) => setDraft((d) => ({ ...d, brand_colors: d.brand_colors.map((x, j) => (j === i ? e.target.value.toUpperCase() : x)) }))}
                  className="h-7 w-9 cursor-pointer"
                />
                <span className="num text-xs">{c}</span>
                <button type="button" aria-label="Quitar color" onClick={() => setDraft((d) => ({ ...d, brand_colors: d.brand_colors.filter((_, j) => j !== i) }))}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {draft.brand_colors.length < 4 && (
              <Button size="sm" variant="outline" onClick={() => setDraft((d) => ({ ...d, brand_colors: [...d.brand_colors, "#000000"] }))}>
                Agregar color
              </Button>
            )}
          </div>
        </section>
        <section className="space-y-3">
          <h3 className="font-semibold">Prompts por tipo</h3>
          <p className="text-xs text-muted-foreground">
            Opcional: describe cómo quieres cada tipo de imagen. Siempre se agrega la regla de respetar el producto tal cual. Vacío usa el de B Systems.
          </p>
          {kinds.map((k) => (
            <div key={k} className="space-y-1">
              <Label htmlFor={`pr-${k}`} className="text-xs">
                {KIND_INFO[k].title}
              </Label>
              <Textarea
                id={`pr-${k}`}
                rows={2}
                maxLength={800}
                value={draft.prompts[k] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, prompts: { ...d.prompts, [k]: e.target.value } }))}
                placeholder={KIND_INFO[k].description}
              />
            </div>
          ))}
        </section>
        <div className="flex gap-2">
          <Button onClick={submit} disabled={save.isPending}>
            Guardar
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
