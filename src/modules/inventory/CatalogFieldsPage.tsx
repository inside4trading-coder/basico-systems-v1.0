/**
 * Campos propios del catálogo y plantillas de rubro. Lo que distingue a un
 * negocio de otro vive aquí como configuración, no en el código.
 */
import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import BackLink from "@/components/BackLink";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTenant } from "@/core/tenant-context";
import { canEditCatalog, canSupervise } from "@/core/tenant-selection";
import { attributeKey, useApplyRubro, useAttributeDefs, useSaveAttributeDef, type AttributeDef } from "./import/api";
import { RUBROS } from "./import/rubros";

const TYPE_LABEL: Record<AttributeDef["type"], string> = { text: "Texto", number: "Número", list: "Lista" };

export default function CatalogFieldsPage() {
  const { active } = useTenant();
  const editable = canSupervise(active?.role);
  const { data: defs = [], isLoading } = useAttributeDefs();
  const save = useSaveAttributeDef();
  const applyRubro = useApplyRubro();
  const [label, setLabel] = useState("");
  const [type, setType] = useState<AttributeDef["type"]>("text");
  const [multi, setMulti] = useState(false);
  const [searchable, setSearchable] = useState(true);

  if (!canEditCatalog(active?.role)) return <Navigate to="/" replace />;

  const add = (event: FormEvent) => {
    event.preventDefault();
    const key = attributeKey(label);
    if (!key) return toast.error("Escribe un nombre para el campo");
    if (defs.some((d) => d.key === key)) return toast.error("Ya existe un campo con ese nombre");
    save.mutate(
      { key, label: label.trim(), type, multi, searchable },
      {
        onSuccess: () => {
          toast.success("Campo creado");
          setLabel("");
          setMulti(false);
          setSearchable(true);
        },
        onError: (err) => toast.error("No se pudo crear", { description: err.message }),
      },
    );
  };

  const toggle = (def: AttributeDef, patch: Partial<Pick<AttributeDef, "multi" | "searchable">>) =>
    save.mutate({ ...def, ...patch }, { onError: (err) => toast.error("No se pudo guardar", { description: err.message }) });

  return (
    <AppShell>
      <div>
        <BackLink to="/inventario">Inventario</BackLink>
        <h1 className="text-2xl">Campos del catálogo</h1>
        <p className="text-sm text-muted-foreground">
          Datos propios de tu negocio: vehículo compatible, principio activo, material… Los marcados como buscables se encuentran desde el buscador.
        </p>
      </div>

      {editable && (
        <section className="space-y-2">
          <p className="mono-cap text-xs text-muted-foreground">Empezar con una plantilla de rubro</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {RUBROS.map((rubro) => (
              <Card key={rubro.id} className="flex flex-col justify-between gap-3 p-4">
                <div className="space-y-1">
                  <p className="font-semibold">{rubro.name}</p>
                  <p className="text-xs text-muted-foreground">{rubro.description}</p>
                  {rubro.attributes.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {rubro.attributes.map((a) => (
                        <Badge key={a.key} variant="outline" className="text-[10px]">
                          {a.label}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={applyRubro.isPending || rubro.attributes.length === 0}
                  onClick={() =>
                    applyRubro.mutate(
                      { attributes: rubro.attributes, existingKeys: defs.map((d) => d.key) },
                      {
                        onSuccess: (n) => toast.success(n ? `${n} campo(s) agregados` : "Ya tenías estos campos"),
                        onError: (err) => toast.error("No se pudo aplicar", { description: err.message }),
                      },
                    )
                  }
                >
                  {rubro.attributes.length === 0 ? "Sin campos extra" : "Agregar sus campos"}
                </Button>
              </Card>
            ))}
          </div>
        </section>
      )}

      {editable && (
        <form onSubmit={add} className="space-y-3 rounded-surface border bg-card p-4">
          <p className="mono-cap text-xs text-muted-foreground">Nuevo campo</p>
          <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
            <div className="space-y-1.5">
              <Label htmlFor="attr-label">Nombre</Label>
              <Input id="attr-label" required value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Vehículo compatible" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="attr-type">Tipo</Label>
              <select
                id="attr-type"
                value={type}
                onChange={(e) => setType(e.target.value as AttributeDef["type"])}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {Object.entries(TYPE_LABEL).map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={multi} onCheckedChange={setMulti} />
              Varios valores por producto
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={searchable} onCheckedChange={setSearchable} />
              Buscable
            </label>
          </div>
          <Button type="submit" disabled={save.isPending}>
            Crear campo
          </Button>
        </form>
      )}

      <ul className="divide-y rounded-surface border bg-card">
        {isLoading && <li className="px-4 py-3 text-sm text-muted-foreground">Cargando…</li>}
        {!isLoading && defs.length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">Todavía no hay campos propios.</li>}
        {defs.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-semibold">{d.label}</span>
              <span className="mono text-xs text-muted-foreground">{d.key}</span>
              <Badge variant="outline">{TYPE_LABEL[d.type]}</Badge>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs">
                <Switch checked={d.multi} disabled={!editable} onCheckedChange={(v) => toggle(d, { multi: v })} />
                Varios valores
              </label>
              <label className="flex items-center gap-2 text-xs">
                <Switch checked={d.searchable} disabled={!editable} onCheckedChange={(v) => toggle(d, { searchable: v })} />
                Buscable
              </label>
            </div>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
