/**
 * Primera pantalla de cada venta: por dónde llegó el cliente y, si es a
 * distancia, si retira o se le envía. Nada viene marcado. También da paso a
 * «Solo consultar POS» y a retomar carritos en espera.
 */
import { useEffect, useState } from "react";
import { Eye, PackageCheck, PauseCircle, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SalesChannel } from "@/modules/settings/api";
import { FULFILLMENT_LABELS, posChannels, type Fulfillment, type SaleContext } from "./saleContext";

export default function ChannelGate({
  channels,
  current,
  heldCount,
  onPick,
  onConsult,
  onResume,
  onBack,
}: {
  channels: SalesChannel[];
  /** Al cambiar desde una venta en curso: lo elegido antes (se puede volver sin tocar nada). */
  current?: SaleContext | null;
  heldCount: number;
  onPick: (channel: SalesChannel, fulfillment: Fulfillment | null) => void;
  onConsult?: () => void;
  onResume?: () => void;
  /** Volver a la venta en curso sin cambiar nada. */
  onBack?: () => void;
}) {
  const list = posChannels(channels);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => setSelected(null), [current?.channelId]);
  const channel = list.find((c) => c.id === selected) ?? null;

  const choose = (c: SalesChannel) => {
    if (c.requires_fulfillment) setSelected(c.id);
    else onPick(c, null);
  };

  return (
    <section className="mx-auto max-w-3xl space-y-5 py-4" aria-label="Origen de la venta">
      <div className="space-y-1 text-center">
        <p className="mono-cap text-[10px] text-muted-foreground">{current ? "Cambiar origen" : "Nueva venta"}</p>
        <h1 className="text-2xl">¿Por dónde llegó el cliente?</h1>
        <p className="text-sm text-muted-foreground">Elige el origen para empezar la venta.</p>
      </div>

      {list.length === 0 ? (
        <p className="rounded-xl border bg-card p-4 text-center text-sm">
          No hay orígenes activos. Actívalos en Configuración → Origen de la venta.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Orígenes">
          {list.map((c) => {
            const isOn = selected === c.id;
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={isOn}
                onClick={() => choose(c)}
                className={cn(
                  "flex min-h-20 flex-col items-start justify-center rounded-xl border-2 bg-card px-5 py-4 text-left transition-colors hover:border-primary",
                  isOn && "border-primary bg-primary/5",
                )}
              >
                <span className="text-lg font-semibold">{c.name}</span>
                <span className="text-xs text-muted-foreground">{c.requires_fulfillment ? "Retiro o envío" : "Venta en el local"}</span>
              </button>
            );
          })}
        </div>
      )}

      {channel && (
        <div className="space-y-3 rounded-xl border bg-card p-4" role="group" aria-label="Modalidad de entrega">
          <p className="text-sm font-semibold">{channel.name}: ¿retira o se le envía?</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["pickup", "envio"] as const).map((f) => (
              <Button key={f} variant="outline" className="h-16 justify-start gap-3 text-base" onClick={() => onPick(channel, f)}>
                {f === "pickup" ? <PackageCheck className="h-5 w-5" /> : <Truck className="h-5 w-5" />}
                {FULFILLMENT_LABELS[f]}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap justify-center gap-2 border-t pt-4">
        {onBack && (
          <Button variant="default" onClick={onBack}>
            Volver a la venta
          </Button>
        )}
        {onConsult && (
          <Button variant="outline" onClick={onConsult}>
            <Eye className="h-4 w-4" /> Solo consultar POS
          </Button>
        )}
        {onResume && heldCount > 0 && (
          <Button variant="outline" onClick={onResume}>
            <PauseCircle className="h-4 w-4" /> Carritos en espera ({heldCount})
          </Button>
        )}
      </div>
    </section>
  );
}
