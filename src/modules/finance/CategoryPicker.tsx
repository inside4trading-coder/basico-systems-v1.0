/**
 * Categoría de un movimiento u obligación: lista visible de las categorías del
 * negocio para esa dirección, con «Nueva categoría» para crearla sin salir del
 * formulario.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { catalogNames, useCatalog, useSaveCatalogItem } from "./api";

const NEW = "__new__";

export default function CategoryPicker({
  id,
  value,
  onChange,
  direction,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  direction: "in" | "out";
}) {
  const { data: catalog = [] } = useCatalog();
  const save = useSaveCatalogItem();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const names = catalogNames(catalog, "category", direction);
  // Un valor viejo que ya no está en el catálogo se sigue mostrando.
  const options = value && !names.includes(value) ? [value, ...names] : names;

  const create = () => {
    const clean = name.trim();
    if (!clean) return;
    const existing = catalog.find((i) => i.kind === "category" && i.name.toLowerCase() === clean.toLowerCase());
    if (existing) {
      onChange(existing.name);
      setAdding(false);
      setName("");
      return;
    }
    save.mutate(
      { kind: "category", name: clean, direction },
      {
        onSuccess: () => {
          onChange(clean);
          setAdding(false);
          setName("");
          toast.success(`Categoría «${clean}» creada`);
        },
        onError: (err) => toast.error("No se pudo crear la categoría", { description: err.message }),
      },
    );
  };

  if (adding) {
    return (
      <div className="flex gap-1">
        <Input
          id={id}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              create();
            }
            if (e.key === "Escape") setAdding(false);
          }}
          placeholder="Nombre de la categoría"
          className="h-11"
          autoFocus
        />
        <Button type="button" className="h-11" disabled={!name.trim() || save.isPending} onClick={create}>
          Crear
        </Button>
        <Button type="button" variant="ghost" className="h-11 px-2" onClick={() => setAdding(false)}>
          ✕
        </Button>
      </div>
    );
  }

  return (
    <select
      id={id}
      value={value}
      onChange={(e) => (e.target.value === NEW ? setAdding(true) : onChange(e.target.value))}
      className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
    >
      <option value="">Sin categoría</option>
      {options.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
      <option value={NEW}>＋ Nueva categoría…</option>
    </select>
  );
}
