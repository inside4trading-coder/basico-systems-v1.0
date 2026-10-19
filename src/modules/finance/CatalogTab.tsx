/**
 * Catálogo de Administración: categorías (de ingreso, de egreso o ambas) y
 * contrapartes. Se sugieren al registrar movimientos y obligaciones. Portado
 * de SublimeAdminSettings (basicosystems@f551478b).
 */
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useCatalog, useSaveCatalogItem, type CatalogItem, type CatalogKind } from "./api";

type DirectionValue = "in" | "out" | "both";
const DIRECTION_LABEL: Record<DirectionValue, string> = { in: "Ingreso", out: "Egreso", both: "Ambos" };
const toDirection = (v: DirectionValue) => (v === "both" ? null : v);
const fromDirection = (d: CatalogItem["direction"]): DirectionValue => d ?? "both";

export default function CatalogTab() {
  const { data: items = [], isLoading, error } = useCatalog();
  if (isLoading) return <p className="mono-cap text-xs text-muted-foreground">Cargando…</p>;
  if (error) return <p className="text-sm text-destructive">No se pudo cargar: {error.message}</p>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <CatalogSection
        kind="category"
        title="Categorías"
        hint="Agrupan ingresos y egresos en el resumen. Las inactivas dejan de sugerirse; los movimientos que ya las usan no cambian."
        items={items.filter((i) => i.kind === "category")}
      />
      <CatalogSection
        kind="counterparty"
        title="Contrapartes"
        hint="Proveedores, clientes, bancos o personas a quienes pagas o de quienes recibes."
        items={items.filter((i) => i.kind === "counterparty")}
      />
    </div>
  );
}

function CatalogSection({ kind, title, hint, items }: { kind: CatalogKind; title: string; hint: string; items: CatalogItem[] }) {
  const save = useSaveCatalogItem();
  const [name, setName] = useState("");
  const [direction, setDirection] = useState<DirectionValue>("out");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDirection, setEditDirection] = useState<DirectionValue>("both");

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    save.mutate(
      { kind, name, direction: toDirection(direction) },
      {
        onSuccess: () => {
          toast.success(`${kind === "category" ? "Categoría" : "Contraparte"} agregada`);
          setName("");
        },
        onError: (err) => toast.error("No se pudo agregar", { description: err.message }),
      },
    );
  };

  const startEdit = (item: CatalogItem) => {
    setEditing(item.id);
    setEditName(item.name);
    setEditDirection(fromDirection(item.direction));
  };

  const saveEdit = (item: CatalogItem) => {
    if (!editName.trim()) return;
    save.mutate(
      { id: item.id, kind, name: editName, direction: toDirection(editDirection), is_active: item.is_active },
      {
        onSuccess: () => setEditing(null),
        onError: (err) => toast.error("No se pudo guardar", { description: err.message }),
      },
    );
  };

  const toggle = (item: CatalogItem, active: boolean) =>
    save.mutate(
      { id: item.id, kind, name: item.name, direction: item.direction, is_active: active },
      { onError: (err) => toast.error("No se pudo cambiar", { description: err.message }) },
    );

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <div>
        <h2 className="text-sm">{title}</h2>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <form onSubmit={add} className="flex flex-wrap gap-2">
        <Input aria-label={`Nueva ${kind === "category" ? "categoría" : "contraparte"}`} placeholder="Nombre" value={name} onChange={(e) => setName(e.target.value)} className="h-9 min-w-0 flex-1 basis-40" />
        {kind === "category" && <DirectionSelect value={direction} onChange={setDirection} />}
        <Button type="submit" size="sm" disabled={save.isPending || !name.trim()}>
          Agregar
        </Button>
      </form>
      {items.length === 0 && <p className="text-sm text-muted-foreground">Sin registros todavía.</p>}
      <ul className="divide-y">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            {editing === item.id ? (
              <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                <Input aria-label="Nombre" value={editName} onChange={(e) => setEditName(e.target.value)} className="h-9 min-w-0 flex-1 basis-40" autoFocus />
                {kind === "category" && <DirectionSelect value={editDirection} onChange={setEditDirection} />}
                <Button size="sm" onClick={() => saveEdit(item)} disabled={save.isPending}>
                  Guardar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                  Cancelar
                </Button>
              </div>
            ) : (
              <>
                <button type="button" className="min-w-0 flex-1 text-left text-sm hover:underline" onClick={() => startEdit(item)}>
                  <span className={item.is_active ? "" : "text-muted-foreground line-through"}>{item.name}</span>
                  {kind === "category" && (
                    <Badge variant="outline" className="ml-2">
                      {DIRECTION_LABEL[fromDirection(item.direction)]}
                    </Badge>
                  )}
                </button>
                <Switch checked={item.is_active} onCheckedChange={(v) => toggle(item, v)} aria-label={`${item.name} activa`} disabled={save.isPending} />
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function DirectionSelect({ value, onChange }: { value: DirectionValue; onChange: (v: DirectionValue) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as DirectionValue)}>
      <SelectTrigger className="h-9 w-32" aria-label="Tipo">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(DIRECTION_LABEL) as DirectionValue[]).map((d) => (
          <SelectItem key={d} value={d}>
            {DIRECTION_LABEL[d]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
