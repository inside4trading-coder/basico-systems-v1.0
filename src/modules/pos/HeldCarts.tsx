/**
 * Carritos en espera: apartar la venta a medias y retomarla desde esta u otra
 * caja de la sede. Portado de la suspensión de carritos de SublimePosApp
 * (basicosystems@f551478b). El carrito retomado se vuelve a cobrar con los
 * precios y el stock del servidor.
 */
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "./cart";
import type { HeldCart } from "./heldApi";

export function HoldDialog({ open, onOpenChange, defaultLabel, busy, onConfirm }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultLabel: string;
  busy: boolean;
  onConfirm: (label: string) => void;
}) {
  const [label, setLabel] = useState(defaultLabel);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    onConfirm(label.trim());
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Poner en espera</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="hold-label">¿De quién es?</Label>
            <Input id="hold-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Señor de la camioneta gris" autoFocus maxLength={60} />
          </div>
          <p className="text-xs text-muted-foreground">No aparta el stock: al retomarlo se cobra con precio y existencia del momento.</p>
          <Button type="submit" className="h-11 w-full" disabled={busy || !label.trim()}>
            Poner en espera
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function HeldListDialog<T>({ open, onOpenChange, carts, currency, busy, cartHasLines, onResume }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  carts: HeldCart<T>[];
  currency: string;
  busy: boolean;
  cartHasLines: boolean;
  onResume: (cart: HeldCart<T>) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>En espera</DialogTitle>
        </DialogHeader>
        {cartHasLines && <p className="text-xs text-muted-foreground">Pon en espera o cobra el carrito actual antes de retomar otro.</p>}
        {carts.length === 0 && <p className="text-sm text-muted-foreground">No hay carritos en espera en esta sede.</p>}
        <ul className="space-y-2">
          {carts.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 rounded-xl border p-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{c.label}</p>
                <p className="text-xs text-muted-foreground">
                  {c.items} {c.items === 1 ? "producto" : "productos"} ·{" "}
                  {new Date(c.created_at).toLocaleTimeString("es-VE", { timeZone: "America/Caracas", hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="num text-sm">{formatMoney(c.total, currency)}</span>
                <Button size="sm" disabled={busy || cartHasLines} onClick={() => onResume(c)}>
                  Retomar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
