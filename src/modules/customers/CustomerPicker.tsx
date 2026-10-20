/**
 * Cliente al cobrar: buscar en la ficha o escribir los datos de uno nuevo.
 * Portado de PosCustomerDialog (basicosystems@f551478b). Sin conexión se
 * escribe igual: al sincronizar, la base lo reconoce por cédula o teléfono.
 */
import { useState } from "react";
import { UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCustomers, type Customer, type SaleCustomer } from "./api";

export default function CustomerPicker({ value, onChange }: { value: SaleCustomer; onChange: (value: SaleCustomer) => void }) {
  const [query, setQuery] = useState("");
  const online = typeof navigator === "undefined" || navigator.onLine;
  const { data: results = [], isFetching } = useCustomers(query, 6, online && query.trim().length >= 2);

  const pick = (c: Customer) => {
    onChange({ id: c.id, name: c.name, doc: c.doc ?? undefined, phone: c.phone ?? undefined });
    setQuery("");
  };

  if (value.id) {
    return (
      <div className="flex items-center gap-3 rounded-lg border p-3">
        <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{value.name}</p>
          <p className="truncate text-xs text-muted-foreground">{[value.doc, value.phone].filter(Boolean).join(" · ") || "Sin documento"}</p>
        </div>
        <Button size="icon" variant="ghost" aria-label="Quitar cliente" onClick={() => onChange({})}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {online && (
        <div className="space-y-1">
          <Label htmlFor="pay-customer-search">Buscar cliente</Label>
          <Input
            id="pay-customer-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nombre, cédula/RIF o teléfono"
            autoComplete="off"
          />
          {query.trim().length >= 2 && (
            <ul className="max-h-48 space-y-1 overflow-y-auto">
              {results.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => pick(c)} className="w-full rounded-lg border p-2 text-left hover:border-primary/50">
                    <p className="truncate text-sm font-semibold">{c.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[c.doc, c.phone].filter(Boolean).join(" · ") || "Sin documento"}
                      {c.purchases > 0 ? ` · ${c.purchases} compra${c.purchases === 1 ? "" : "s"}` : ""}
                    </p>
                  </button>
                </li>
              ))}
              {!isFetching && results.length === 0 && <li className="text-xs text-muted-foreground">Sin coincidencias: escribe sus datos abajo.</li>}
            </ul>
          )}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="pay-customer">Nombre</Label>
          <Input id="pay-customer" value={value.name ?? ""} onChange={(e) => onChange({ ...value, name: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pay-doc">Cédula o RIF</Label>
          <Input id="pay-doc" value={value.doc ?? ""} onChange={(e) => onChange({ ...value, doc: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pay-phone">Teléfono</Label>
          <Input id="pay-phone" inputMode="tel" value={value.phone ?? ""} onChange={(e) => onChange({ ...value, phone: e.target.value })} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Con nombre y cédula o teléfono queda en la ficha de clientes.</p>
    </div>
  );
}

