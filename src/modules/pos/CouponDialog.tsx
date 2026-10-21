import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/core/money";
import { validateCoupon } from "@/modules/settings/couponsApi";
import { isValidCouponCode, normalizeCouponCode, type AppliedCoupon } from "./coupons";

/** El cajero escribe o escanea el código; el servidor dice si vale y cuánto descuenta. */
export default function CouponDialog({
  open,
  onOpenChange,
  base,
  currency,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Compra después de los descuentos por línea, en moneda base. */
  base: number;
  currency: string;
  onApply: (coupon: AppliedCoupon) => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setCode("");
  }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const normalized = normalizeCouponCode(code);
    if (!isValidCouponCode(normalized)) return toast.error("Código inválido");
    setBusy(true);
    try {
      const c = await validateCoupon(normalized, base);
      onApply({ code: c.code, description: c.description, kind: c.kind, value: Number(c.value), minPurchase: Number(c.min_purchase) });
      toast.success(`Cupón ${c.code} aplicado`, { description: `Descuenta ${formatMoney(Number(c.discount), currency)}` });
      onOpenChange(false);
    } catch (err) {
      toast.error("No se aplicó el cupón", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cupón</DialogTitle>
          <DialogDescription>Escribe o escanea el código del cupón.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex gap-2">
          <Input
            aria-label="Código del cupón"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="mono h-11 uppercase"
            placeholder="NAVIDAD"
            autoFocus
          />
          <Button type="submit" className="h-11" disabled={busy || !code.trim()}>
            {busy ? "Validando…" : "Aplicar"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
