/**
 * Clientes: la ficha de cada uno y su historial de compras. Portado de
 * SublimeClientes (basicosystems@f551478b). Se crean al cobrar en el POS o
 * aquí; no se borran porque las ventas los necesitan.
 */
import { useEffect, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useTenant } from "@/core/tenant-context";
import { formatDateTime } from "@/modules/inventory/lib";
import { formatMoney } from "@/modules/pos/cart";
import { useCustomerSales, useCustomers, useSaveCustomer, type Customer, type CustomerDraft } from "./api";

const EMPTY: CustomerDraft = { name: "", doc: null, phone: null, email: null, address: null, notes: null };

export default function CustomersPage() {
  const { active } = useTenant();
  const base = active?.tenant.base_currency ?? "USD";
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState<Customer | "new" | null>(null);
  const { data: customers = [], isLoading } = useCustomers(debounced);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <AppShell wide>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Clientes</h1>
          <p className="text-sm text-muted-foreground">Se crean solos al cobrar con nombre y cédula o teléfono.</p>
        </div>
        <Button onClick={() => setOpen("new")}>
          <Plus className="mr-1 h-4 w-4" /> Nuevo cliente
        </Button>
      </div>
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre, cédula/RIF, teléfono o correo" aria-label="Buscar cliente" />

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-3">Cliente</th>
              <th className="p-3">Cédula / RIF</th>
              <th className="p-3">Teléfono</th>
              <th className="p-3 text-right">Compras</th>
              <th className="p-3 text-right">Total</th>
              <th className="p-3">Última compra</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} className="cursor-pointer border-b last:border-0 hover:bg-muted/40" onClick={() => setOpen(c)}>
                <td className="p-3 font-semibold">{c.name}</td>
                <td className="p-3">{c.doc ?? "—"}</td>
                <td className="p-3">{c.phone ?? "—"}</td>
                <td className="num p-3 text-right">{c.purchases}</td>
                <td className="num p-3 text-right">{formatMoney(c.total, base)}</td>
                <td className="p-3 text-muted-foreground">{c.last_purchase ? formatDateTime(c.last_purchase) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!isLoading && customers.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">{debounced ? "Sin coincidencias." : "Todavía no hay clientes."}</p>
        )}
      </div>

      <CustomerSheet customer={open} base={base} onClose={() => setOpen(null)} />
    </AppShell>
  );
}

function CustomerSheet({ customer, base, onClose }: { customer: Customer | "new" | null; base: string; onClose: () => void }) {
  const existing = customer && customer !== "new" ? customer : null;
  const [draft, setDraft] = useState<CustomerDraft>(EMPTY);
  const save = useSaveCustomer();
  const { data: sales = [] } = useCustomerSales(existing?.id ?? null);

  useEffect(() => {
    setDraft(existing ? { name: existing.name, doc: existing.doc, phone: existing.phone, email: existing.email, address: existing.address, notes: existing.notes } : EMPTY);
  }, [customer]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!customer) return null;
  const set = (key: keyof CustomerDraft) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [key]: e.target.value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim()) return toast.error("Escribe el nombre");
    save.mutate(
      { id: existing?.id ?? null, draft },
      {
        onSuccess: () => {
          toast.success(existing ? "Cliente actualizado" : "Cliente creado");
          if (!existing) onClose();
        },
        onError: (err) => toast.error("No se pudo guardar", { description: err.message }),
      },
    );
  };

  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{existing ? existing.name : "Nuevo cliente"}</SheetTitle>
        </SheetHeader>
        {existing && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="secondary">
              {existing.purchases} compra{existing.purchases === 1 ? "" : "s"}
            </Badge>
            <Badge variant="outline">{formatMoney(existing.total, base)}</Badge>
          </div>
        )}
        <form className="mt-4 space-y-3" onSubmit={submit}>
          <div className="space-y-1">
            <Label htmlFor="cu-name">Nombre *</Label>
            <Input id="cu-name" value={draft.name} onChange={set("name")} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="cu-doc">Cédula o RIF</Label>
              <Input id="cu-doc" value={draft.doc ?? ""} onChange={set("doc")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cu-phone">Teléfono</Label>
              <Input id="cu-phone" inputMode="tel" value={draft.phone ?? ""} onChange={set("phone")} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cu-email">Correo</Label>
            <Input id="cu-email" type="email" value={draft.email ?? ""} onChange={set("email")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cu-address">Dirección</Label>
            <Input id="cu-address" value={draft.address ?? ""} onChange={set("address")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cu-notes">Notas</Label>
            <Textarea id="cu-notes" rows={2} value={draft.notes ?? ""} onChange={set("notes")} />
          </div>
          <Button type="submit" className="w-full" disabled={save.isPending}>
            {existing ? "Guardar cambios" : "Crear cliente"}
          </Button>
        </form>

        {existing && (
          <section className="mt-6 space-y-2">
            <h2 className="text-sm">Compras</h2>
            {sales.length === 0 && <p className="text-xs text-muted-foreground">Sin compras registradas.</p>}
            <ul className="space-y-1">
              {sales.map((s) => (
                <li key={s.id} className="flex items-center justify-between rounded-lg border p-2 text-xs">
                  <span>
                    <span className="font-semibold">{s.number}</span> · {formatDateTime(s.sold_at)}
                    {s.status === "voided" && <span className="text-destructive"> · anulada</span>}
                  </span>
                  <span className="num">{formatMoney(s.total, s.base_currency)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </SheetContent>
    </Sheet>
  );
}
