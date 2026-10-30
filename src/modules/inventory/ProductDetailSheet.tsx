/**
 * Detalle de un producto: todo lo que se sabe de él, incluidos los datos que
 * llegaron en columnas extra al importar (código original, ubicación,
 * proveedor…). Los campos propios, la descripción y la oferta se editan aquí;
 * precio, SKU y costo también se editan en la tabla.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { productTaxRate, withTax, type TaxRateLike } from "@/core/tax";
import { useUpdateProduct, useUpdateVariant, type CatalogRow } from "./api";
import { useAttributeDefs } from "./import/api";
import { CODE_KIND_LABEL } from "./import/fields";
import { formatMoney, formatQty, isPartner, originLabel, productOrigin, variantLabel, type Location } from "./lib";
import { splitValues, useProductAttributes, useSaveProductAttribute } from "./productAttributes";

export default function ProductDetailSheet({
  rows,
  locations,
  taxRates,
  currency,
  editable,
  onClose,
}: {
  /** Filas (variantes) del producto abierto; vacío = cerrado. */
  rows: CatalogRow[];
  locations: Location[];
  taxRates: TaxRateLike[];
  currency: string;
  editable: boolean;
  onClose: () => void;
}) {
  const product = rows[0]?.product ?? null;
  const { data: defs = [] } = useAttributeDefs();
  const { data: values = [] } = useProductAttributes(product?.id ?? null);
  const saveAttr = useSaveProductAttribute();
  const updProduct = useUpdateProduct();
  const updVariant = useUpdateVariant();
  const fail = (err: Error) => toast.error("No se pudo guardar", { description: err.message });

  const valueOf = (attributeId: string) =>
    values
      .filter((v) => v.attribute_id === attributeId)
      .map((v) => v.value)
      .join("; ");
  // Primero los campos con dato; los vacíos solo si se pueden llenar.
  const fields = defs.filter((d) => valueOf(d.id) || editable).sort((a, b) => Number(Boolean(valueOf(b.id))) - Number(Boolean(valueOf(a.id))));
  const activeLocations = locations.filter((l) => l.is_active);
  const ownLocations = activeLocations.filter((l) => !isPartner(l));
  const partnerLocations = activeLocations.filter(isPartner);
  const origin = productOrigin(
    rows.flatMap((r) => r.stocks),
    activeLocations,
  );

  return (
    <Sheet open={product !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {product && (
          <div className="space-y-6">
            <SheetHeader>
              <SheetTitle className="pr-6 text-left">{product.name}</SheetTitle>
              <SheetDescription className="text-left">
                {[product.brand, product.category].filter(Boolean).join(" · ") || "Sin marca ni categoría"}
              </SheetDescription>
              {partnerLocations.length > 0 && (
                <Badge variant={origin.kind === "own" ? "outline" : "secondary"} className="w-fit">
                  {originLabel(origin)}
                </Badge>
              )}
            </SheetHeader>

            <section className="space-y-2">
              <p className="mono-cap text-xs text-muted-foreground">Datos del producto</p>
              {fields.length === 0 ? (
                <p className="text-sm text-muted-foreground">Este producto no tiene datos extra. Se agregan al importar con «+ Agregar dato» o en Campos.</p>
              ) : (
                <dl className="divide-y rounded-md border">
                  {fields.map((d) => (
                    <div key={d.id} className="grid grid-cols-[140px_minmax(0,1fr)] items-center gap-3 px-3 py-2 text-sm">
                      <dt className="text-muted-foreground">{d.label}</dt>
                      <dd>
                        {editable ? (
                          <SavedInput
                            key={`${d.id}|${valueOf(d.id)}`}
                            value={valueOf(d.id)}
                            placeholder={d.multi ? "Varios, separados por ;" : "—"}
                            label={d.label}
                            onSave={(text) =>
                              saveAttr.mutate({ productId: product.id, attributeId: d.id, values: splitValues(text, d.multi) }, { onError: fail })
                            }
                          />
                        ) : (
                          valueOf(d.id) || "—"
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>

            <section className="space-y-2">
              <p className="mono-cap text-xs text-muted-foreground">Descripción</p>
              {editable ? (
                <SavedInput
                  key={product.description ?? ""}
                  value={product.description ?? ""}
                  placeholder="Sin descripción"
                  label="Descripción"
                  onSave={(text) => updProduct.mutate({ id: product.id, patch: { description: text || null } }, { onError: fail })}
                />
              ) : (
                <p className="text-sm">{product.description || "—"}</p>
              )}
            </section>

            {rows.map((r) => {
              const rate = productTaxRate(product.tax_rate_id, taxRates);
              const net = r.variant.price ?? r.variant.regular_price;
              const hasOffer = r.variant.price != null && r.variant.regular_price != null && Number(r.variant.price) < Number(r.variant.regular_price);
              return (
                <section key={r.variant.id} className="space-y-2">
                  <p className="mono-cap text-xs text-muted-foreground">
                    {rows.length > 1 ? variantLabel(r.variant.options) : "Precio y existencias"}
                  </p>
                  <dl className="divide-y rounded-md border text-sm">
                    <Line label="SKU">
                      <span className="font-mono text-xs">{r.variant.sku ?? "—"}</span>
                    </Line>
                    {r.codes.map((c) => (
                      <Line key={c.id} label={CODE_KIND_LABEL[c.kind] ?? `Código ${c.kind}`}>
                        <span className="font-mono text-xs">{c.code}</span>
                      </Line>
                    ))}
                    <Line label="Precio sin IVA">{r.variant.regular_price == null ? "—" : formatMoney(Number(r.variant.regular_price), currency)}</Line>
                    <Line label="Oferta sin IVA">
                      {editable ? (
                        <SavedInput
                          key={`${r.variant.id}|${hasOffer ? r.variant.price : ""}`}
                          value={hasOffer ? String(r.variant.price) : ""}
                          placeholder="Sin oferta"
                          label="Oferta sin IVA"
                          onSave={(text) => {
                            const n = text === "" ? null : Number(text.replace(",", "."));
                            if (n != null && (Number.isNaN(n) || n < 0)) return toast.error("Escribe un monto válido");
                            // Sin oferta, el precio de venta vuelve a ser el precio normal.
                            updVariant.mutate({ id: r.variant.id, patch: { price: n ?? r.variant.regular_price } }, { onError: fail });
                          }}
                        />
                      ) : hasOffer ? (
                        formatMoney(Number(r.variant.price), currency)
                      ) : (
                        "Sin oferta"
                      )}
                    </Line>
                    <Line label={`PVP (IVA ${rate} %)`}>
                      <span className="font-semibold">{net == null ? "—" : formatMoney(withTax(Number(net), rate), currency)}</span>
                    </Line>
                    <Line label="Costo">{r.variant.cost == null ? "—" : formatMoney(Number(r.variant.cost), currency)}</Line>
                    {ownLocations.map((l) => (
                      <Line key={l.id} label={ownLocations.length > 1 ? `Inventario · ${l.name}` : "Inventario"}>
                        <span className="num">{formatQty(Number(r.stocks.find((s) => s.location_id === l.id)?.on_hand ?? 0))}</span>
                      </Line>
                    ))}
                    {partnerLocations.map((l) => (
                      <Line key={l.id} label={`En aliado · ${l.name}`}>
                        <span className="num">{formatQty(Number(r.stocks.find((s) => s.location_id === l.id)?.on_hand ?? 0))}</span>
                        <span className="ml-2 text-xs text-muted-foreground">se vende por encargo</span>
                      </Line>
                    ))}
                    <Line label="Estado">
                      <Badge variant={r.variant.is_active && product.is_active ? "default" : "outline"}>
                        {r.variant.is_active && product.is_active ? "Activo" : "Inactivo"}
                      </Badge>
                    </Line>
                  </dl>
                </section>
              );
            })}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] items-center gap-3 px-3 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** Campo que guarda al salir si cambió. */
function SavedInput({ value, placeholder, label, onSave }: { value: string; placeholder: string; label: string; onSave: (text: string) => void }) {
  const [draft, setDraft] = useState(value);
  return (
    <Input
      value={draft}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft.trim() !== value.trim() && onSave(draft.trim())}
      className="h-8 text-sm"
    />
  );
}
