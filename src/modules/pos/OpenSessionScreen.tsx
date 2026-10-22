/**
 * Elegir caja: continuar una sesión abierta o abrir una nueva con su fondo por
 * moneda. Portado de PosOpenSessionScreen.tsx (basicosystems@f551478b).
 */
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTenant } from "@/core/tenant-context";
import { useLocations } from "@/modules/inventory/api";
import { useCashiers } from "@/modules/settings/api";
import { cn } from "@/lib/utils";
import { useOpenSession, useOpenSessions, useRegisters, type Register } from "./api";
import { useAllowedLocations } from "@/core/locationAccess";
import { cashCurrencyLabel } from "@/core/money";
import { parseAmount, usePosMoney } from "./usePosMoney";

export default function OpenSessionScreen({ onSelect }: { onSelect: (sessionId: string) => void }) {
  const { active, can } = useTenant();
  const registers = useRegisters();
  const sessions = useOpenSessions();
  const { data: locations = [] } = useLocations();
  const allowed = useAllowedLocations();
  const usable = (registers.data ?? []).filter((r) => r.is_active && (!allowed || allowed.has(r.location_id)));

  if (registers.isLoading || sessions.isLoading) {
    return <p className="mono-cap text-xs text-muted-foreground">Cargando cajas…</p>;
  }

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl">Punto de venta</h1>
        <p className="text-sm text-muted-foreground">Elige la caja con la que vas a vender.</p>
      </div>
      {usable.length === 0 && (
        <div className="rounded-xl border bg-card p-4 text-sm">
          <p>No hay cajas activas.</p>
          {can("config.sedes") ? (
            <Link to="/sedes" className="text-primary underline">
              Crear una caja en Sedes
            </Link>
          ) : (
            <p className="text-muted-foreground">Pide a un administrador que cree una.</p>
          )}
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {usable.map((r) => {
          const open = (sessions.data ?? []).find((s) => s.register_id === r.id);
          const location = locations.find((l) => l.id === r.location_id);
          return (
            <div key={r.id} className="space-y-3 rounded-xl border bg-card p-4">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-semibold">
                  <span className="mono mr-2 text-xs text-muted-foreground">{r.code}</span>
                  {r.name}
                </p>
                <span className="text-xs text-muted-foreground">{location?.name}</span>
              </div>
              {open ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm">
                    Abierta · <span className="mono">{open.number}</span>
                  </span>
                  <Button onClick={() => onSelect(open.id)}>Continuar</Button>
                </div>
              ) : (
                <OpenForm register={r} onOpened={onSelect} />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function OpenForm({ register, onOpened }: { register: Register; onOpened: (id: string) => void }) {
  const { currencies } = usePosMoney();
  const open = useOpenSession();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const { data: allCashiers = [] } = useCashiers();
  const cashiers = allCashiers.filter((c) => c.is_active && c.works_pos && (!c.location_id || c.location_id === register.location_id));
  const [cashierId, setCashierId] = useState<string | null>(null);
  const needsCashier = cashiers.length > 0;

  // mutateAsync y no callbacks de mutate: al refrescar las sesiones esta tarjeta
  // pasa a "Continuar" y se desmonta antes de que corra un onSuccess por llamada.
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const opening = currencies.map((currency) => ({ currency, amount: parseAmount(amounts[currency] ?? "") })).filter((o) => o.amount > 0);
    if (needsCashier && !cashierId) return toast.error("Elige quién abre la caja");
    try {
      const res = await open.mutateAsync({ registerId: register.id, opening, cashierId });
      toast.success(`Caja abierta · ${res.number}`);
      onOpened(res.session_id);
    } catch (err) {
      toast.error("No se pudo abrir la caja", { description: (err as Error).message });
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {needsCashier && (
        <fieldset className="space-y-2">
          <legend className="mono-cap text-[10px] text-muted-foreground">¿Quién abre la caja?</legend>
          <div className="flex flex-wrap gap-2">
            {cashiers.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={cashierId === c.id}
                onClick={() => setCashierId(c.id)}
                className={cn(
                  "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                  cashierId === c.id ? "border-primary bg-primary/10 font-semibold text-primary" : "hover:border-primary",
                )}
              >
                {c.name}
                {c.job_title && <span className="block text-[11px] font-normal text-muted-foreground">{c.job_title}</span>}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <p className="mono-cap text-[10px] text-muted-foreground">Fondo de caja</p>
      <div className="grid grid-cols-2 gap-2">
        {currencies.map((c) => (
          <div key={c} className="space-y-1">
            <Label htmlFor={`open-${register.id}-${c}`}>
              Efectivo {cashCurrencyLabel(c)}
            </Label>
            <Input
              id={`open-${register.id}-${c}`}
              inputMode="decimal"
              placeholder="0,00"
              value={amounts[c] ?? ""}
              onChange={(e) => setAmounts({ ...amounts, [c]: e.target.value })}
              className="num h-11"
            />
          </div>
        ))}
      </div>
      <Button type="submit" className="h-11 w-full" disabled={open.isPending || (needsCashier && !cashierId)}>
        {open.isPending ? "Abriendo…" : "Abrir caja"}
      </Button>
    </form>
  );
}
