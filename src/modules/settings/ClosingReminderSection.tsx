/** Hora desde la que el POS recuerda cerrar la caja. Portado de useSublimePosConfig (basicosystems@f551478b). */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTenantSettings, useUpdateTenantSettings } from "./api";

export default function ClosingReminderSection() {
  const { data: settings } = useTenantSettings();
  const update = useUpdateTenantSettings();
  const [time, setTime] = useState("17:30");

  useEffect(() => {
    if (settings?.closing_reminder_time) setTime(settings.closing_reminder_time.slice(0, 5));
  }, [settings?.closing_reminder_time]);

  if (!settings) return null;
  const enabled = Boolean(settings.closing_reminder_time);

  const save = (value: string | null) =>
    update.mutate(
      { closing_reminder_time: value },
      {
        onSuccess: () => toast.success(value ? `El POS recordará cerrar la caja desde las ${value}` : "Recordatorio de cierre apagado"),
        onError: (err) => toast.error("No se pudo guardar", { description: err.message }),
      },
    );

  return (
    <Card className="space-y-3 p-4">
      <div>
        <p className="mono-cap text-xs text-muted-foreground">Cierre de caja</p>
        <p className="text-sm text-muted-foreground">Desde esa hora el POS avisa en rojo mientras la caja siga abierta. Nunca la cierra solo.</p>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={enabled} disabled={update.isPending} onCheckedChange={(v) => save(v ? time : null)} />
          Recordar cerrar la caja
        </label>
        <div className="space-y-1">
          <Label htmlFor="closing-time">Desde las</Label>
          <Input
            id="closing-time"
            type="time"
            className="w-32"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            onBlur={() => enabled && time && time !== settings.closing_reminder_time?.slice(0, 5) && save(time)}
          />
        </div>
      </div>
    </Card>
  );
}
