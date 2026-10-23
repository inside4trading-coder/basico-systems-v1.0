/**
 * Datos de envío de la venta: se escriben o se pegan del chat («PEGAR DATOS»,
 * lectura local sin IA). Con la cédula se busca el cliente en la ficha: si
 * existe se puede asociar y completar el formulario; si no, se puede crear.
 * La ficha solo se completa (nunca se sobrescribe) y solo si el cajero lo confirma.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ClipboardPaste, UserCheck, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useCustomers, useSaveCustomer, type Customer, type SaleCustomer } from "@/modules/customers/api";
import { digits, profileAdditions, sameDoc } from "./customerMatch";
import {
  CARRIERS,
  DELIVERY_LABELS,
  EMPTY_DELIVERY,
  VE_STATES,
  deliveryProblems,
  parseDeliveryText,
  splitName,
  type DeliveryData,
  type DeliveryField,
} from "./parse";

export default function DeliveryDialog({
  open,
  onOpenChange,
  value,
  customer,
  online,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: DeliveryData | null;
  customer: SaleCustomer | null;
  online: boolean;
  onSave: (delivery: DeliveryData, customer: SaleCustomer | null) => void;
}) {
  const [form, setForm] = useState<DeliveryData>(EMPTY_DELIVERY);
  const [linked, setLinked] = useState<SaleCustomer | null>(null);
  const [review, setReview] = useState<Partial<Record<DeliveryField, string>>>({});
  const [pasteBox, setPasteBox] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({ ...EMPTY_DELIVERY, ...(value ?? {}) });
    setLinked(customer?.id ? customer : null);
    setReview({});
    setPasteBox(null);
    setTried(false);
    // Solo al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (field: DeliveryField, v: string) => {
    setForm((f) => ({ ...f, [field]: v }));
    setReview((r) => {
      const { [field]: _drop, ...rest } = r;
      return rest;
    });
  };

  // Búsqueda por cédula en la ficha (pausa para no consultar en cada tecla).
  const docDigits = digits(form.doc);
  const [lookup, setLookup] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setLookup(docDigits.length >= 6 ? docDigits : ""), 350);
    return () => clearTimeout(t);
  }, [docDigits]);
  const found = useCustomers(lookup, 10, open && online && lookup.length >= 6);
  const match = useMemo(
    () => (lookup && lookup === docDigits ? (found.data ?? []).find((c) => sameDoc(c.doc, form.doc)) ?? null : null),
    [found.data, lookup, docDigits, form.doc],
  );
  const searched = Boolean(lookup) && lookup === docDigits && !found.isFetching && found.isFetched;
  const save = useSaveCustomer();

  const applyText = (text: string) => {
    const r = parseDeliveryText(text);
    const filled = (Object.keys(r.data) as DeliveryField[]).filter((f) => r.data[f]);
    if (filled.length === 0) {
      toast.error("No se reconocieron datos en el texto");
      return;
    }
    setForm((f) => ({ ...f, ...Object.fromEntries(filled.map((k) => [k, r.data[k]])) }));
    setReview(Object.fromEntries(r.review.map((x) => [x.field, x.reason])));
    setPasteBox(null);
    const missing = r.missing.map((f) => DELIVERY_LABELS[f]);
    toast.success(`Datos pegados: ${filled.length} de 8 campos`, {
      description: missing.length ? `Falta: ${missing.join(", ")}.` : r.review.length ? "Revisa los campos marcados." : undefined,
    });
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) return applyText(text);
    } catch {
      // Sin permiso para leer el portapapeles: se pega a mano.
    }
    setPasteBox("");
  };

  const link = (c: Customer) => {
    const name = splitName(c.name);
    setForm((f) => ({
      ...f,
      first_name: f.first_name || name.first,
      last_name: f.last_name || name.last,
      phone: f.phone || c.phone || "",
      doc: f.doc || c.doc || "",
    }));
    setLinked({ id: c.id, name: c.name, doc: c.doc ?? undefined, phone: c.phone ?? undefined });
  };

  const additions = match ? profileAdditions(match, form) : {};
  const additionLabels = [additions.doc && "cédula", additions.phone && "teléfono", additions.address && "dirección"].filter(Boolean);

  const completeProfile = (c: Customer) =>
    save.mutate(
      {
        id: c.id,
        draft: {
          name: c.name,
          doc: c.doc || additions.doc || null,
          phone: c.phone || additions.phone || null,
          email: c.email,
          address: c.address || additions.address || null,
          notes: c.notes,
        },
      },
      {
        onSuccess: () => toast.success("Ficha del cliente completada"),
        onError: (err) => toast.error("No se pudo actualizar la ficha", { description: err.message }),
      },
    );

  const create = () => {
    const name = `${form.first_name} ${form.last_name}`.trim();
    if (!name) return toast.error("Escribe nombre y apellido para crear el cliente");
    save.mutate(
      {
        id: null,
        draft: {
          name,
          doc: form.doc,
          phone: form.phone || null,
          email: null,
          address: [form.address, form.municipality && `Municipio ${form.municipality}`, form.state].filter(Boolean).join(", ") || null,
          notes: null,
        },
      },
      {
        onSuccess: async () => {
          const r = await found.refetch();
          const c = (r.data ?? []).find((x) => sameDoc(x.doc, form.doc));
          if (c) setLinked({ id: c.id, name: c.name, doc: c.doc ?? undefined, phone: c.phone ?? undefined });
          toast.success("Cliente creado y asociado a la venta");
        },
        onError: (err) => toast.error("No se pudo crear el cliente", { description: err.message }),
      },
    );
  };

  const problems = deliveryProblems(form);
  const trimmed = () => Object.fromEntries(Object.entries(form).map(([k, v]) => [k, String(v).trim()])) as unknown as DeliveryData;
  // Cerrar guarda lo escrito: se puede completar durante la venta; el cobro lo exige completo.
  const close = () => {
    onSave(trimmed(), linked);
    onOpenChange(false);
  };
  const submit = () => {
    setTried(true);
    if (problems.length) return toast.error("Faltan datos del envío", { description: problems.map((f) => DELIVERY_LABELS[f]).join(", ") });
    close();
  };

  const field = (f: DeliveryField, props: { className?: string; inputMode?: "tel" | "text"; placeholder?: string } = {}) => {
    const bad = (tried && problems.includes(f)) || Boolean(review[f]);
    return (
      <div className={cn("space-y-1", props.className)}>
        <Label htmlFor={`dlv-${f}`}>{DELIVERY_LABELS[f]}</Label>
        <Input
          id={`dlv-${f}`}
          value={form[f]}
          inputMode={props.inputMode}
          placeholder={props.placeholder}
          aria-invalid={bad}
          className={cn(bad && "border-destructive")}
          onChange={(e) => set(f, e.target.value)}
        />
        {review[f] && <p className="text-xs text-destructive">{review[f]}</p>}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Datos del envío</DialogTitle>
        </DialogHeader>

        {pasteBox === null ? (
          <Button type="button" variant="outline" className="h-12 w-full gap-2 font-semibold tracking-wide" onClick={paste}>
            <ClipboardPaste className="h-5 w-5" /> PEGAR DATOS
          </Button>
        ) : (
          <div className="space-y-2 rounded-xl border p-3">
            <Label htmlFor="dlv-paste">Pega aquí el mensaje del cliente</Label>
            <Textarea id="dlv-paste" rows={6} value={pasteBox} onChange={(e) => setPasteBox(e.target.value)} autoFocus />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setPasteBox(null)}>
                Cancelar
              </Button>
              <Button type="button" disabled={!pasteBox.trim()} onClick={() => applyText(pasteBox)}>
                Leer datos
              </Button>
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {field("first_name")}
          {field("last_name")}
          {field("doc", { placeholder: "V-12345678" })}
          {field("phone", { inputMode: "tel", placeholder: "0414-1234567" })}
          {field("address", { className: "sm:col-span-2", placeholder: "Calle, casa o edificio, sector, referencia" })}
          {field("municipality")}
          <div className="space-y-1">
            <Label htmlFor="dlv-state">Estado</Label>
            <select
              id="dlv-state"
              value={VE_STATES.includes(form.state) ? form.state : ""}
              onChange={(e) => set("state", e.target.value)}
              aria-invalid={(tried && problems.includes("state")) || Boolean(review.state)}
              className={cn(
                "flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm",
                ((tried && problems.includes("state")) || review.state) && "border-destructive",
              )}
            >
              <option value="">Elige…</option>
              {VE_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {review.state && <p className="text-xs text-destructive">{review.state}: «{form.state}»</p>}
          </div>
          <div className="space-y-1 sm:col-span-2">
            <p className="text-sm font-medium">Empresa de envío</p>
            <div className="flex gap-2" role="group" aria-label="Empresa de envío">
              {CARRIERS.map((c) => (
                <Button
                  key={c}
                  type="button"
                  variant={form.carrier === c ? "default" : "outline"}
                  aria-pressed={form.carrier === c}
                  className={cn("flex-1", ((tried && problems.includes("carrier")) || review.carrier) && form.carrier !== c && "border-destructive")}
                  onClick={() => set("carrier", c)}
                >
                  {c}
                </Button>
              ))}
            </div>
            {review.carrier && <p className="text-xs text-destructive">{review.carrier}</p>}
          </div>
        </div>

        {/* Cliente de la ficha por cédula. */}
        <div className="space-y-2 rounded-xl border p-3 text-sm" aria-live="polite">
          {linked ? (
            <div className="flex items-center gap-3">
              <UserCheck className="h-4 w-4 shrink-0 text-primary" />
              <p className="min-w-0 flex-1 truncate">
                Cliente asociado: <span className="font-semibold">{linked.name}</span>
                {linked.doc && <span className="text-muted-foreground"> · {linked.doc}</span>}
              </p>
              <Button type="button" size="sm" variant="ghost" onClick={() => setLinked(null)}>
                <X className="h-4 w-4" /> Quitar
              </Button>
            </div>
          ) : !online ? (
            <p className="text-muted-foreground">Sin conexión: la venta guarda la cédula y la ficha se reconoce al sincronizar.</p>
          ) : docDigits.length < 6 ? (
            <p className="text-muted-foreground">Escribe la cédula para buscar al cliente en la ficha.</p>
          ) : match ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="min-w-0 flex-1">
                <span className="font-semibold text-primary">Cliente encontrado:</span> {match.name}
                <span className="text-muted-foreground"> · {[match.doc, match.phone].filter(Boolean).join(" · ")}</span>
              </p>
              <Button type="button" size="sm" onClick={() => link(match)}>
                <UserCheck className="h-4 w-4" /> Asociar y completar
              </Button>
            </div>
          ) : searched ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="min-w-0 flex-1 text-muted-foreground">No hay un cliente con esa cédula.</p>
              <Button type="button" size="sm" variant="outline" disabled={save.isPending} onClick={create}>
                <UserPlus className="h-4 w-4" /> Crear cliente
              </Button>
            </div>
          ) : (
            <p className="mono-cap text-xs text-muted-foreground">Buscando cliente…</p>
          )}
          {linked && match && linked.id === match.id && additionLabels.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-t pt-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="min-w-0 flex-1 text-muted-foreground">La ficha no tiene {additionLabels.join(", ")}. ¿Agregarlo desde el envío?</p>
              <Button type="button" size="sm" variant="outline" disabled={save.isPending} onClick={() => completeProfile(match)}>
                Completar ficha
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            Completar después
          </Button>
          <Button type="button" onClick={submit}>
            Guardar envío
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
