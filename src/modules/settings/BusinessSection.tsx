/**
 * Datos del negocio que salen en la nota de entrega: razón social, RIF,
 * dirección, teléfono y pie de página. Portado de useSublimeReceiptSettings
 * (basicosystems@f551478b). Cada sede puede tener su propia dirección y
 * teléfono (Sedes).
 */
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTenantSettings, useUpdateTenantSettings } from "./api";

interface Draft {
  legal_name: string;
  tax_id: string;
  address: string;
  phone: string;
  receipt_footer: string;
}

const FIELDS: { key: keyof Draft; label: string; placeholder?: string }[] = [
  { key: "legal_name", label: "Razón social", placeholder: "Comercial Ejemplo, C.A." },
  { key: "tax_id", label: "RIF", placeholder: "J-12345678-9" },
  { key: "address", label: "Dirección" },
  { key: "phone", label: "Teléfono" },
  { key: "receipt_footer", label: "Pie de la nota", placeholder: "Gracias por su compra. Cambios dentro de 7 días con la nota." },
];

export default function BusinessSection() {
  const { data: settings } = useTenantSettings();
  const update = useUpdateTenantSettings();
  const [draft, setDraft] = useState<Draft>({ legal_name: "", tax_id: "", address: "", phone: "", receipt_footer: "" });

  useEffect(() => {
    if (!settings) return;
    setDraft({
      legal_name: settings.legal_name ?? "",
      tax_id: settings.tax_id ?? "",
      address: settings.address ?? "",
      phone: settings.phone ?? "",
      receipt_footer: settings.receipt_footer ?? "",
    });
  }, [settings]);

  if (!settings) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const clean = (v: string) => (v.trim() ? v.trim() : null);
    update.mutate(
      {
        legal_name: clean(draft.legal_name),
        tax_id: clean(draft.tax_id)?.toUpperCase() ?? null,
        address: clean(draft.address),
        phone: clean(draft.phone),
        receipt_footer: clean(draft.receipt_footer),
      },
      {
        onSuccess: () => toast.success("Datos del negocio guardados"),
        onError: (err) => toast.error("No se pudo guardar", { description: err.message }),
      },
    );
  };

  return (
    <Card className="space-y-3 p-4">
      <div>
        <p className="mono-cap text-xs text-muted-foreground">Datos del negocio</p>
        <p className="text-sm text-muted-foreground">Salen en la nota de entrega. La dirección y el teléfono de cada sede se cargan en Sedes.</p>
      </div>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
        {FIELDS.map((f) => (
          <div key={f.key} className={f.key === "address" || f.key === "receipt_footer" ? "space-y-1 sm:col-span-2" : "space-y-1"}>
            <Label htmlFor={`biz-${f.key}`}>{f.label}</Label>
            <Input
              id={`biz-${f.key}`}
              value={draft[f.key]}
              placeholder={f.placeholder}
              onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
            />
          </div>
        ))}
        <div className="sm:col-span-2">
          <Button type="submit" disabled={update.isPending}>
            Guardar
          </Button>
        </div>
      </form>
    </Card>
  );
}
