/**
 * Orígenes de la venta: por dónde llegó el cliente. Portado de
 * PosChannelPicker y esp_sales_channels (basicosystems@f551478b).
 */
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useSaveSalesChannel, useSalesChannels, useTenantSettings, useUpdateTenantSettings } from "./api";

export default function ChannelsSection() {
  const { data: channels = [] } = useSalesChannels();
  const { data: settings } = useTenantSettings();
  const save = useSaveSalesChannel();
  const update = useUpdateTenantSettings();
  const [name, setName] = useState("");
  const fail = (err: Error) => toast.error("No se pudo guardar", { description: err.message });

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    save.mutate(
      { name: name.trim(), position: channels.length + 1 },
      {
        onSuccess: () => {
          toast.success(`Origen «${name.trim()}» agregado`);
          setName("");
        },
        onError: fail,
      },
    );
  };

  return (
    <Card className="space-y-3 p-4">
      <div>
        <p className="mono-cap text-xs text-muted-foreground">Origen de la venta</p>
        <p className="text-sm text-muted-foreground">Por dónde llegó el cliente. Se elige al cobrar y se suma en Reportes.</p>
      </div>
      {settings && (
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={settings.channel_required}
            disabled={update.isPending}
            onCheckedChange={(v) =>
              update.mutate(
                { channel_required: v },
                { onSuccess: () => toast.success(v ? "El POS pedirá el origen en cada venta" : "El origen queda opcional"), onError: fail },
              )
            }
          />
          Obligatorio en el POS
        </label>
      )}
      <ul className="space-y-2">
        {channels.map((c) => (
          <li key={c.id} className="flex items-center gap-3 rounded-lg border p-2">
            <Input
              aria-label={`Nombre de ${c.name}`}
              defaultValue={c.name}
              className="h-9 flex-1"
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== c.name) save.mutate({ id: c.id, name: v }, { onSuccess: () => toast.success("Origen renombrado"), onError: fail });
              }}
            />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={c.is_active} onCheckedChange={(v) => save.mutate({ id: c.id, is_active: v }, { onError: fail })} />
              {c.is_active ? "Activo" : "Inactivo"}
            </label>
          </li>
        ))}
      </ul>
      <form className="flex gap-2" onSubmit={add}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Feria, Mercado Libre…" aria-label="Nuevo origen" />
        <Button type="submit" variant="outline" disabled={!name.trim() || save.isPending}>
          Agregar
        </Button>
      </form>
    </Card>
  );
}
