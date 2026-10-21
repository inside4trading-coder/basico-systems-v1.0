/**
 * Cabecera de Inicio, "Mis accesos" con su personalización y la actividad
 * reciente de este dispositivo.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowDown, ArrowLeftRight, ArrowUp, BarChart3, CalendarClock, ClipboardCheck, Clock, HandCoins, Landmark, Layers, ListChecks, type LucideIcon, MapPin, Package, PackagePlus, Receipt, RefreshCw, Scale, Settings, ShoppingCart, SlidersHorizontal, Sparkles, Upload, UserCog, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/core/auth";
import { useTenant } from "@/core/tenant-context";
import { useEntitlements } from "@/core/useEntitlements";
import { useHomeShortcuts, useSaveHomeShortcuts } from "./api";
import { readRecent } from "./recent";
import { allowedShortcuts, MAX_SHORTCUTS, moveKey, selectShortcuts, shortcutForPath, type Shortcut, type ShortcutIcon } from "./shortcuts";

const ICONS: Record<ShortcutIcon, LucideIcon> = {
  cart: ShoppingCart,
  package: Package,
  clipboard: ClipboardCheck,
  "package-plus": PackagePlus,
  arrows: ArrowLeftRight,
  "list-checks": ListChecks,
  refresh: RefreshCw,
  upload: Upload,
  sliders: SlidersHorizontal,
  users: Users,
  chart: BarChart3,
  receipt: Receipt,
  landmark: Landmark,
  calendar: CalendarClock,
  "hand-coins": HandCoins,
  scale: Scale,
  "map-pin": MapPin,
  settings: Settings,
  "user-cog": UserCog,
  clock: Clock,
  sparkles: Sparkles,
  layers: Layers,
};

const TZ = "America/Caracas";
const dateFormat = new Intl.DateTimeFormat("es-VE", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
const timeFormat = new Intl.DateTimeFormat("es-VE", { timeZone: TZ, hour: "numeric", minute: "2-digit" });

/** Hora actual, refrescada al cambiar el minuto. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    const timeout = setTimeout(() => {
      setNow(new Date());
      interval = setInterval(() => setNow(new Date()), 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, []);
  return now;
}

function firstName(meta: Record<string, unknown> | undefined, email: string | undefined): string {
  const full = typeof meta?.full_name === "string" ? meta.full_name.trim() : "";
  if (full) return full.split(/\s+/)[0];
  return email?.split("@")[0] ?? "";
}

export function Greeting() {
  const { session } = useAuth();
  const { active } = useTenant();
  const now = useNow();
  const name = firstName(session?.user.user_metadata, session?.user.email);
  const date = dateFormat.format(now);

  return (
    <div className="space-y-1">
      <p className="mono-cap text-xs text-muted-foreground">
        {active?.tenant.name} · <span className="first-letter:uppercase">{date}</span> · <span className="num">{timeFormat.format(now)}</span>
      </p>
      <h1 className="text-2xl">Hola{name ? `, ${name}` : ""}</h1>
      <p className="text-sm text-muted-foreground">¿Qué necesitas hacer hoy?</p>
    </div>
  );
}

function useAllowedShortcuts(): Shortcut[] {
  const role = useTenant().active?.role;
  const entitlements = useEntitlements();
  return useMemo(() => allowedShortcuts(role, entitlements), [role, entitlements]);
}

export function MyShortcuts() {
  const allowed = useAllowedShortcuts();
  const { data: saved, isLoading } = useHomeShortcuts();
  const [editing, setEditing] = useState(false);
  const shown = selectShortcuts(saved, allowed);

  if (allowed.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm">Mis accesos</h2>
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={isLoading}>
          Personalizar
        </Button>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No elegiste accesos. Usa Personalizar para agregarlos.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {shown.map((s) => (
            <li key={s.key}>
              <ShortcutCard shortcut={s} />
            </li>
          ))}
        </ul>
      )}
      {editing && <CustomizeDialog allowed={allowed} current={shown.map((s) => s.key)} onClose={() => setEditing(false)} />}
    </section>
  );
}

function ShortcutCard({ shortcut }: { shortcut: Shortcut }) {
  const Icon = ICONS[shortcut.icon];
  return (
    <Link to={shortcut.to} className="flex h-full flex-col gap-2 rounded-xl border bg-card p-3 transition-colors hover:border-primary">
      <Icon className="h-5 w-5 text-primary" aria-hidden />
      <span className="text-sm font-semibold leading-tight">{shortcut.label}</span>
      <span className="text-[11px] text-muted-foreground">{shortcut.caption}</span>
    </Link>
  );
}

function CustomizeDialog({ allowed, current, onClose }: { allowed: Shortcut[]; current: string[]; onClose: () => void }) {
  const [keys, setKeys] = useState(current);
  const save = useSaveHomeShortcuts();
  const byKey = new Map(allowed.map((s) => [s.key, s]));
  const full = keys.length >= MAX_SHORTCUTS;

  const toggle = (key: string, on: boolean) => setKeys((prev) => (on ? [...prev, key] : prev.filter((k) => k !== key)));
  const persist = (next: string[] | null) =>
    save.mutate(next, {
      onSuccess: onClose,
      onError: (err) => toast.error("No se pudo guardar", { description: err.message }),
    });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Personalizar accesos</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          <p className="mono-cap text-xs text-muted-foreground">
            Orden ({keys.length}/{MAX_SHORTCUTS})
          </p>
          {keys.length === 0 ? (
            <p className="text-sm text-muted-foreground">Marca abajo los que quieras ver en Inicio.</p>
          ) : (
            <ol className="space-y-1">
              {keys.map((k, i) => (
                <li key={k} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
                  <span className="num w-4 text-xs text-muted-foreground">{i + 1}</span>
                  <span className="flex-1">{byKey.get(k)?.label ?? k}</span>
                  <Button size="icon" variant="ghost" className="h-8 w-8" disabled={i === 0} onClick={() => setKeys(moveKey(keys, k, -1))} aria-label={`Subir ${byKey.get(k)?.label ?? k}`}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    disabled={i === keys.length - 1}
                    onClick={() => setKeys(moveKey(keys, k, 1))}
                    aria-label={`Bajar ${byKey.get(k)?.label ?? k}`}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="space-y-2">
          <p className="mono-cap text-xs text-muted-foreground">Disponibles</p>
          <ul className="grid gap-1 sm:grid-cols-2">
            {allowed.map((s) => {
              const checked = keys.includes(s.key);
              const id = `shortcut-${s.key}`;
              return (
                <li key={s.key} className="flex items-center gap-2 text-sm">
                  <Checkbox id={id} checked={checked} disabled={!checked && full} onCheckedChange={(v) => toggle(s.key, v === true)} />
                  <label htmlFor={id} className="cursor-pointer">
                    {s.label} <span className="text-xs text-muted-foreground">· {s.caption}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => persist(null)} disabled={save.isPending}>
            Restablecer
          </Button>
          <Button onClick={() => persist(keys)} disabled={save.isPending}>
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RecentActivity() {
  const tenantId = useTenant().active?.tenant.id;
  const allowed = useAllowedShortcuts();
  const [recent] = useState(() => readRecent(tenantId));
  const allowedKeys = new Set(allowed.map((s) => s.key));
  const items = recent.flatMap((path) => {
    const s = shortcutForPath(path);
    return s && allowedKeys.has(s.key) ? [{ path, shortcut: s }] : [];
  });

  if (items.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm">Actividad reciente</h2>
      <div className="flex flex-wrap gap-2">
        {items.map(({ path, shortcut }) => {
          const Icon = ICONS[shortcut.icon];
          return (
            <Link key={path} to={path} className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs hover:border-primary">
              <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              {shortcut.label}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
