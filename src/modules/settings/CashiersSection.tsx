/**
 * Personal de caja: quienes atienden sin usuario propio. Se eligen en el POS
 * y el reporte por cajero usa su nombre. Portado de ConfigCajeros
 * (basicosystems@f551478b).
 */
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useLocations } from "@/modules/inventory/api";
import { useCashiers, useSaveCashier } from "./api";

export default function CashiersSection() {
  const { data: cashiers = [] } = useCashiers();
  const { data: locations = [] } = useLocations();
  const save = useSaveCashier();
  const [name, setName] = useState("");
  const [locationId, setLocationId] = useState("");
  const fail = (err: Error) => toast.error("No se pudo guardar", { description: err.message });

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    save.mutate(
      { name: name.trim(), location_id: locationId || null },
      {
        onSuccess: () => {
          toast.success(`${name.trim()} agregado al personal de caja`);
          setName("");
        },
        onError: fail,
      },
    );
  };

  const select = "h-9 rounded-md border border-input bg-background px-2 text-sm";

  return (
    <Card className="space-y-3 p-4">
      <div>
        <p className="mono-cap text-xs text-muted-foreground">Personal de caja</p>
        <p className="text-sm text-muted-foreground">
          Quienes atienden sin usuario propio. Se eligen en el POS («Atiende») y el reporte por cajero usa su nombre.
        </p>
      </div>
      <ul className="space-y-2">
        {cashiers.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
            <Input
              aria-label={`Nombre de ${c.name}`}
              defaultValue={c.name}
              className="h-9 min-w-40 flex-1"
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== c.name) save.mutate({ id: c.id, name: v }, { onError: fail });
              }}
            />
            <select
              aria-label={`Sede de ${c.name}`}
              className={select}
              value={c.location_id ?? ""}
              onChange={(e) => save.mutate({ id: c.id, location_id: e.target.value || null }, { onError: fail })}
            >
              <option value="">Todas las sedes</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={c.is_active} onCheckedChange={(v) => save.mutate({ id: c.id, is_active: v }, { onError: fail })} />
              {c.is_active ? "Activo" : "Inactivo"}
            </label>
          </li>
        ))}
        {cashiers.length === 0 && <li className="text-sm text-muted-foreground">Nadie todavía: cada venta queda a nombre del usuario que cobra.</li>}
      </ul>
      <form className="flex flex-wrap gap-2" onSubmit={add}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" aria-label="Nombre del cajero" className="min-w-40 flex-1" />
        <select aria-label="Sede del cajero" className={select} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
          <option value="">Todas las sedes</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline" disabled={!name.trim() || save.isPending}>
          Agregar
        </Button>
      </form>
    </Card>
  );
}
