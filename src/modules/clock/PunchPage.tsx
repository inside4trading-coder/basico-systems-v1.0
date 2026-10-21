/**
 * Fichar desde el teléfono, sin cuenta: /fichar/<clave del negocio>. La
 * persona pone su PIN, ve qué le toca (entrada, descanso, salida) y la app
 * manda su ubicación; la base decide si está dentro de la sede. Portado de
 * SublimeFichajePublico.tsx (basicosystems@f551478b).
 *
 * El PIN solo vive en memoria y se olvida a los dos minutos sin uso.
 */
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Delete } from "lucide-react";
import BrandMark from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { clockLookup, clockPunch, type ClockLookup, type ClockToday } from "./api";
import { KIND_LABEL, type ClockKind } from "./lib";

const IDLE_MS = 120_000;
const timeFmt = new Intl.DateTimeFormat("es-VE", { timeZone: "America/Caracas", hour: "2-digit", minute: "2-digit" });

type Position = { latitude: number; longitude: number; accuracy: number };

function currentPosition(): Promise<Position> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Este teléfono no da la ubicación"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }),
      (err) =>
        reject(
          new Error(
            err.code === err.PERMISSION_DENIED
              ? "Permite la ubicación en el navegador para fichar"
              : "No se pudo obtener la ubicación. Intenta de nuevo, mejor cerca de una ventana.",
          ),
        ),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  });
}

export default function PunchPage() {
  const { clockKey = "" } = useParams();
  const [pin, setPin] = useState("");
  const [who, setWho] = useState<ClockLookup | null>(null);
  const [today, setToday] = useState<ClockToday | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const idle = useRef<number>();

  const reset = () => {
    setPin("");
    setWho(null);
    setToday(null);
    setError(null);
    setDone(null);
  };

  // Olvida el PIN tras un rato sin uso.
  useEffect(() => {
    window.clearTimeout(idle.current);
    if (pin || who) idle.current = window.setTimeout(reset, IDLE_MS);
    return () => window.clearTimeout(idle.current);
  }, [pin, who, today]);

  const press = async (digit: string) => {
    if (busy || pin.length >= 6) return;
    const next = pin + digit;
    setPin(next);
    setError(null);
    if (next.length < 6) return;
    setBusy(true);
    try {
      const res = await clockLookup(clockKey, next);
      if (!res.ok) {
        setError(res.error ?? "No se pudo verificar");
        setPin("");
        return;
      }
      setWho(res);
      setToday(res.today ?? null);
    } catch (err) {
      setError((err as Error).message);
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  const punch = async (kind: ClockKind) => {
    setBusy(true);
    setError(null);
    try {
      const position = who?.needs_location ? await currentPosition() : await currentPosition().catch(() => null);
      const res = await clockPunch(clockKey, pin, kind, position);
      if (!res.ok) {
        setError(res.error ?? "No se pudo fichar");
        if (res.today) setToday(res.today);
        return;
      }
      setToday(res.today ?? null);
      navigator.vibrate?.(120);
      const late = res.late_minutes ? ` · ${res.late_minutes} min tarde` : "";
      const review = res.status === "revisar" ? " · queda para revisión del encargado" : "";
      setDone(`${KIND_LABEL[kind]} registrada a las ${timeFmt.format(new Date())}${late}${review}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col gap-5 bg-background px-4 py-6">
      <header className="flex items-center justify-between">
        <BrandMark className="text-lg" />
        <span className="mono-cap text-xs text-muted-foreground">Fichaje</span>
      </header>

      {!who ? (
        <section className="space-y-5" aria-label="Ingresar PIN">
          <div className="space-y-1 text-center">
            <h1 className="text-2xl">Pon tu PIN</h1>
            <p className="text-sm text-muted-foreground">Los 6 números que te dio tu encargado.</p>
          </div>
          <div className="flex justify-center gap-2" aria-live="polite" aria-label={`${pin.length} de 6 números`}>
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} className={cn("h-3.5 w-3.5 rounded-full border-2 border-primary", i < pin.length && "bg-primary")} />
            ))}
          </div>
          {error && (
            <p role="alert" className="text-center text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="grid grid-cols-3 gap-3">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <Button key={d} type="button" variant="outline" className="h-16 text-2xl" disabled={busy} onClick={() => press(d)}>
                {d}
              </Button>
            ))}
            <span />
            <Button type="button" variant="outline" className="h-16 text-2xl" disabled={busy} onClick={() => press("0")}>
              0
            </Button>
            <Button type="button" variant="ghost" className="h-16" aria-label="Borrar" disabled={busy || !pin} onClick={() => setPin(pin.slice(0, -1))}>
              <Delete />
            </Button>
          </div>
        </section>
      ) : (
        <section className="space-y-4" aria-label="Fichar">
          <div>
            <p className="text-sm text-muted-foreground">{who.business}</p>
            <h1 className="text-2xl">Hola, {who.name}</h1>
            {who.location && <p className="text-sm text-muted-foreground">{who.location}</p>}
          </div>
          {done && (
            <p role="status" className="rounded-lg border border-primary bg-primary/10 p-3 text-sm">
              {done}
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="grid gap-2">
            {(today?.allowed ?? []).map((k) => (
              <Button key={k} className="h-14 text-lg" variant={k === "entrada" || k === "salida" ? "default" : "outline"} disabled={busy} onClick={() => punch(k)}>
                {busy ? "Ubicando…" : KIND_LABEL[k]}
              </Button>
            ))}
          </div>
          {who.needs_location && <p className="text-xs text-muted-foreground">Se usa tu ubicación solo para comprobar que estás en la sede.</p>}
          {today && today.events.length > 0 && (
            <div className="space-y-1">
              <p className="mono-cap text-xs text-muted-foreground">Hoy</p>
              <ul className="divide-y rounded-lg border">
                {today.events.map((e) => (
                  <li key={e.at} className="flex justify-between px-3 py-2 text-sm">
                    <span>{KIND_LABEL[e.kind]}</span>
                    <span className="num">{timeFmt.format(new Date(e.at))}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Button variant="ghost" className="w-full" onClick={reset}>
            Terminar
          </Button>
        </section>
      )}
    </main>
  );
}
