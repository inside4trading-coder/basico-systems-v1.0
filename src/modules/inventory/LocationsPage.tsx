import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTenant } from "@/core/tenant-context";
import { useEntitlements } from "@/core/useEntitlements";
import { useLocations, useSaveLocation } from "./api";
import { useRegisters, useSaveRegister } from "@/modules/pos/api";
import type { Location } from "./lib";

const TYPE_LABEL: Record<Location["type"], string> = {
  store: "Tienda",
  warehouse: "Almacén",
  popup: "Punto temporal",
  external: "Externa",
};

interface Draft {
  id?: string;
  name: string;
  code: string;
  type: Location["type"];
  sells_in_pos: boolean;
  is_active: boolean;
  address: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  clock_radius_m: number;
}

const EMPTY: Draft = {
  name: "",
  code: "",
  type: "store",
  sells_in_pos: true,
  is_active: true,
  address: null,
  phone: null,
  latitude: null,
  longitude: null,
  clock_radius_m: 100,
};

export default function LocationsPage() {
  const { active, can } = useTenant();
  const { data: locations = [], isLoading } = useLocations();
  const save = useSaveLocation();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const { fichaje } = useEntitlements();

  if (!can("config.sedes")) return <Navigate to="/" replace />;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(draft, {
      onSuccess: () => {
        toast.success(draft.id ? "Sede actualizada" : "Sede creada");
        setDraft(EMPTY);
      },
      onError: (err) => toast.error("No se pudo guardar", { description: err.message }),
    });
  };

  return (
    <AppShell>
      <h1 className="text-2xl">Sedes</h1>

      <form onSubmit={submit} className="space-y-3 rounded-surface border bg-card p-4">
        <p className="mono-cap text-xs text-muted-foreground">{draft.id ? "Editar sede" : "Nueva sede"}</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem_10rem]">
          <div className="space-y-1.5">
            <Label htmlFor="loc-name">Nombre</Label>
            <Input id="loc-name" required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="loc-code">Código</Label>
            <Input
              id="loc-code"
              required
              maxLength={16}
              pattern="[A-Za-z0-9][A-Za-z0-9\-]*"
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
              placeholder="T1"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="loc-type">Tipo</Label>
            <select
              id="loc-type"
              value={draft.type}
              onChange={(e) => setDraft({ ...draft, type: e.target.value as Location["type"] })}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {Object.entries(TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <div className="space-y-1.5">
            <Label htmlFor="loc-address">Dirección (sale en la nota de entrega)</Label>
            <Input id="loc-address" value={draft.address ?? ""} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="loc-phone">Teléfono</Label>
            <Input id="loc-phone" inputMode="tel" value={draft.phone ?? ""} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
          </div>
        </div>
        {fichaje && <ClockLocationFields draft={draft} onChange={setDraft} />}
        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={draft.sells_in_pos} onCheckedChange={(v) => setDraft({ ...draft, sells_in_pos: v })} />
            Vende en POS
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={draft.is_active} onCheckedChange={(v) => setDraft({ ...draft, is_active: v })} />
            Activa
          </label>
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={save.isPending}>
            {draft.id ? "Guardar cambios" : "Crear sede"}
          </Button>
          {draft.id && (
            <Button type="button" variant="ghost" onClick={() => setDraft(EMPTY)}>
              Cancelar
            </Button>
          )}
        </div>
      </form>

      <ul className="divide-y rounded-surface border bg-card">
        {isLoading && <li className="px-4 py-3 text-sm text-muted-foreground">Cargando…</li>}
        {!isLoading && locations.length === 0 && (
          <li className="px-4 py-3 text-sm text-muted-foreground">Todavía no hay sedes.</li>
        )}
        {locations.map((l) => (
          <li key={l.id} className="space-y-2 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="mono text-xs text-muted-foreground">{l.code}</span>
              <span className="font-semibold">{l.name}</span>
              <Badge variant="outline">{TYPE_LABEL[l.type]}</Badge>
              {l.sells_in_pos && <Badge variant="secondary">POS</Badge>}
              {!l.is_active && <Badge variant="destructive">Inactiva</Badge>}
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setDraft({
                  id: l.id,
                  name: l.name,
                  code: l.code,
                  type: l.type,
                  sells_in_pos: l.sells_in_pos,
                  is_active: l.is_active,
                  address: l.address,
                  phone: l.phone,
                  latitude: l.latitude,
                  longitude: l.longitude,
                  clock_radius_m: l.clock_radius_m,
                })
              }
            >
              Editar
            </Button>
            </div>
            {l.sells_in_pos && <RegistersOf locationId={l.id} />}
          </li>
        ))}
      </ul>
    </AppShell>
  );
}

/** Cajas de una sede que vende: cada una abre su propia sesión de caja. */
function RegistersOf({ locationId }: { locationId: string }) {
  const { data: registers = [] } = useRegisters();
  const save = useSaveRegister();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const mine = registers.filter((r) => r.location_id === locationId);

  const add = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(
      { location_id: locationId, name: name.trim(), code },
      {
        onSuccess: () => {
          setName("");
          setCode("");
          toast.success("Caja creada");
        },
        onError: (err) => toast.error("No se pudo crear la caja", { description: err.message }),
      },
    );
  };

  return (
    <div className="space-y-2 rounded-lg bg-muted/40 p-3">
      <p className="mono-cap text-[10px] text-muted-foreground">Cajas</p>
      {mine.length === 0 && <p className="text-xs text-muted-foreground">Sin cajas: crea al menos una para vender.</p>}
      <div className="flex flex-wrap gap-2">
        {mine.map((r) => (
          <label key={r.id} className="flex items-center gap-2 rounded-md border bg-card px-2 py-1 text-xs">
            <span className="mono">{r.code}</span> {r.name}
            <Switch
              checked={r.is_active}
              aria-label={`Activa ${r.name}`}
              onCheckedChange={(v) => save.mutate({ id: r.id, is_active: v }, { onError: (err) => toast.error("No se pudo guardar", { description: err.message }) })}
            />
          </label>
        ))}
      </div>
      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Caja 1" className="h-8 w-32 text-xs" aria-label="Nombre de la caja" />
        <Input
          required
          maxLength={16}
          pattern="[A-Za-z0-9][A-Za-z0-9\-]*"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="C1"
          className="h-8 w-20 text-xs"
          aria-label="Código de la caja"
        />
        <Button type="submit" size="sm" variant="outline" disabled={save.isPending}>
          Agregar caja
        </Button>
      </form>
    </div>
  );
}

/**
 * Ubicación de la sede para el fichaje: el personal solo ficha dentro del
 * radio. Lo más simple es cargarla desde la tienda con el teléfono.
 */
function ClockLocationFields({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) {
  const [locating, setLocating] = useState(false);
  const coord = (text: string) => {
    const n = Number(text.trim().replace(",", "."));
    return text.trim() === "" || !Number.isFinite(n) ? null : n;
  };
  const useHere = () => {
    if (!navigator.geolocation) return toast.error("Este equipo no da la ubicación");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        onChange({ ...draft, latitude: Number(pos.coords.latitude.toFixed(6)), longitude: Number(pos.coords.longitude.toFixed(6)) });
        toast.success(`Ubicación tomada (precisión ${Math.round(pos.coords.accuracy)} m)`);
      },
      (err) => {
        setLocating(false);
        toast.error("No se pudo obtener la ubicación", { description: err.message });
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-sm font-medium">Ubicación para fichar</p>
      <p className="text-xs text-muted-foreground">
        El personal ficha desde su teléfono solo si está dentro del radio. Sin ubicación, los fichajes de esta sede quedan por revisar.
      </p>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_8rem_auto] sm:items-end">
        <div className="space-y-1">
          <Label htmlFor="loc-lat">Latitud</Label>
          <Input id="loc-lat" inputMode="decimal" value={draft.latitude ?? ""} onChange={(e) => onChange({ ...draft, latitude: coord(e.target.value) })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="loc-lng">Longitud</Label>
          <Input id="loc-lng" inputMode="decimal" value={draft.longitude ?? ""} onChange={(e) => onChange({ ...draft, longitude: coord(e.target.value) })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="loc-radius">Radio (m)</Label>
          <Input
            id="loc-radius"
            inputMode="numeric"
            value={draft.clock_radius_m}
            onChange={(e) => onChange({ ...draft, clock_radius_m: Math.min(2000, Math.max(20, Number(e.target.value) || 100)) })}
          />
        </div>
        <Button type="button" variant="outline" onClick={useHere} disabled={locating}>
          {locating ? "Ubicando…" : "Usar mi ubicación"}
        </Button>
      </div>
    </div>
  );
}
