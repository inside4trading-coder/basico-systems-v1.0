/**
 * Inventario: productos, variantes, precios y existencias por sede.
 * Portado de SublimeInventarioMaestro.tsx (basicosystems@f551478b). Se
 * quitaron Woo, lotes de Abastecimiento y "proponer stock": las existencias
 * entran por Control (entradas y ajustes), no se editan en esta tabla.
 * Tocar el nombre abre el detalle con todos sus datos (incluidos los
 * importados) y la oferta.
 */
import { ScanButton } from "@/core/scanner/CameraScanner";
import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus, SlidersHorizontal } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useTenant } from "@/core/tenant-context";
import { productTaxRate, withTax } from "@/core/tax";
import { useTaxRates } from "@/modules/settings/api";
import { useCatalog, useLocations, useUpdateProduct, useUpdateVariant } from "./api";
import { formatMoney, formatQty, isPartner, productOrigin, SALE_BLOCK_LABEL, saleBlockers, sumStock, variantLabel } from "./lib";
import NewProductDialog from "./NewProductDialog";
import ProductDetailSheet from "./ProductDetailSheet";
import { ProductPhotoButton } from "./ProductPhoto";
import { BulkApplyButton, CostHistoryButton } from "./VariantTools";

export default function InventoryPage() {
  const { active, can } = useTenant();
  const currency = active?.tenant.base_currency ?? "USD";
  const editable = can("catalogo.editar");
  const { data, isLoading } = useCatalog();
  const { data: locations = [] } = useLocations();
  const updVariant = useUpdateVariant();
  const updProduct = useUpdateProduct();
  const { data: taxRates = [] } = useTaxRates();
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [locationId, setLocationId] = useState("all");
  const [category, setCategory] = useState("all");
  const [brand, setBrand] = useState("all");
  const [status, setStatus] = useState("all");
  const [origin, setOrigin] = useState("all");
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const rows = useMemo(() => data?.rows ?? [], [data]);
  // Sedes propias primero; los aliados (sedes externas) al final.
  const activeLocations = locations.filter((l) => l.is_active).sort((a, b) => Number(isPartner(a)) - Number(isPartner(b)));
  const hasPartners = activeLocations.some(isPartner);
  // Se vende lo de las sedes con POS y, por encargo, lo de los aliados.
  const sellingIds = useMemo(
    () => new Set(locations.filter((l) => l.is_active && (l.sells_in_pos || isPartner(l))).map((l) => l.id)),
    [locations],
  );
  const partnerIds = useMemo(() => new Set(locations.filter(isPartner).map((l) => l.id)), [locations]);

  const enriched = useMemo(
    () =>
      rows.map((r) => {
        // Existencia y valor del inventario: solo lo propio, no lo del aliado.
        const total = sumStock(r.stocks.filter((s) => !partnerIds.has(s.location_id)));
        const origin = productOrigin(r.stocks, locations).kind;
        const sellable = sumStock(r.stocks, sellingIds).available;
        const blockers = saleBlockers({ product: r.product, variant: r.variant, sellableStock: sellable });
        const totalReserved = r.stocks.reduce((a, s) => a + Number(s.reserved), 0);
        const stockAt = (id: string) => Number(r.stocks.find((s) => s.location_id === id)?.on_hand ?? 0);
        const codesText = r.codes.map((c) => c.code).join(" ");
        return { ...r, total, totalReserved, blockers, stockAt, codesText, origin };
      }),
    [rows, sellingIds, partnerIds, locations],
  );

  const categories = useMemo(() => uniq(rows.map((r) => r.product.category)), [rows]);
  const brands = useMemo(() => uniq(rows.map((r) => r.product.brand)), [rows]);

  const filtered = enriched.filter((r) => {
    if (category !== "all" && r.product.category !== category) return false;
    if (brand !== "all" && r.product.brand !== brand) return false;
    if (status === "sellable" && r.blockers.length > 0) return false;
    if (status === "blocked" && r.blockers.length === 0) return false;
    if (status === "inactive" && r.variant.is_active) return false;
    if (locationId !== "all" && !(r.stockAt(locationId) > 0)) return false;
    if (origin === "own" && r.origin === "partner") return false;
    if (origin === "partner" && r.origin === "own") return false;
    if (q.trim()) {
      const text = [r.product.name, r.product.brand, r.variant.sku, variantLabel(r.variant.options), r.codesText].join(" ").toLowerCase();
      if (!q.toLowerCase().split(/\s+/).every((w) => text.includes(w))) return false;
    }
    return true;
  });

  type Row = (typeof enriched)[number];
  const groups = useMemo(() => {
    const m = new Map<string, { product: Row["product"]; items: Row[] }>();
    for (const r of filtered) {
      const g = m.get(r.product.id) ?? { product: r.product, items: [] };
      g.items.push(r);
      m.set(r.product.id, g);
    }
    return [...m.values()];
  }, [filtered]);

  const toggleGroup = (id: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const saveVariant = (id: string, patch: Parameters<typeof updVariant.mutate>[0]["patch"]) =>
    updVariant.mutate({ id, patch }, { onError: (err) => toast.error("No se pudo guardar", { description: err.message }) });

  // Sin oferta, el precio de venta sigue al precio normal (si no, el PVP no cambiaría).
  const savePrice = (r: (typeof rows)[number], n: number | null) => {
    const noOffer = r.variant.price == null || Number(r.variant.price) === Number(r.variant.regular_price);
    saveVariant(r.variant.id, noOffer ? { regular_price: n, price: n } : { regular_price: n });
  };

  const sellableCount = enriched.filter((r) => r.blockers.length === 0).length;
  const stockValue = enriched.reduce((a, r) => a + r.total.onHand * Number(r.variant.cost ?? 0), 0);
  const columns = 8 + activeLocations.length;

  return (
    <AppShell wide>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Inventario</h1>
          <p className="text-sm text-muted-foreground">Productos, precios y existencias por sede</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link to="/control">Entradas y ajustes</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/inventario/etiquetas">Etiquetas</Link>
          </Button>
          {editable && (
            <>
              <Button variant="outline" asChild>
                <Link to="/inventario/importar">Importar / Exportar</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/catalogo/campos">Campos</Link>
              </Button>
            </>
          )}
          {editable && (
            <Button onClick={() => setCreating(true)} disabled={activeLocations.length === 0}>
              <Plus /> Nuevo producto
            </Button>
          )}
        </div>
      </div>

      {activeLocations.length === 0 && !isLoading && (
        <Card className="p-4 text-sm">
          No hay sedes activas. {editable ? <Link className="underline" to="/sedes">Crea una sede</Link> : "Pide al administrador que cree una sede"} antes de cargar productos.
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Productos" value={String(data?.products.length ?? 0)} />
        <Stat label="Variantes" value={String(rows.length)} />
        <Stat label="Listas para vender" value={String(sellableCount)} />
        <Stat label="Stock valorizado" value={formatMoney(stockValue, currency)} hint="A costo" />
      </div>

      <Card className="space-y-3 rounded-surface p-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <SlidersHorizontal className="h-3.5 w-3.5" /> Filtros
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <div className="flex gap-2">
            <Input placeholder="Buscar nombre, SKU, código…" value={q} onChange={(e) => setQ(e.target.value)} />
            <ScanButton className="shrink-0 px-3" onScan={setQ} />
          </div>
          <Picker value={locationId} onChange={setLocationId} allLabel="Todas las sedes" options={activeLocations.map((l) => ({ value: l.id, label: l.name }))} />
          <Picker value={category} onChange={setCategory} allLabel="Todas las categorías" options={categories.map((c) => ({ value: c, label: c }))} />
          <Picker value={brand} onChange={setBrand} allLabel="Todas las marcas" options={brands.map((b) => ({ value: b, label: b }))} />
          <Picker
            value={status}
            onChange={setStatus}
            allLabel="Todos los estados"
            options={[
              { value: "sellable", label: "Listas para vender" },
              { value: "blocked", label: "Con pendientes" },
              { value: "inactive", label: "Inactivas" },
            ]}
          />
          {hasPartners && (
            <Picker
              value={origin}
              onChange={setOrigin}
              allLabel="Propios y de aliados"
              options={[
                { value: "own", label: "Propios" },
                { value: "partner", label: "De aliados" },
              ]}
            />
          )}
        </div>
      </Card>

      <Card className="overflow-x-auto rounded-surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead className="text-right">Precio sin IVA</TableHead>
              <TableHead>IVA</TableHead>
              <TableHead className="whitespace-nowrap text-right">PVP</TableHead>
              <TableHead className="text-right">Costo</TableHead>
              {activeLocations.map((l) => (
                <TableHead key={l.id} className="whitespace-nowrap text-right">
                  {l.name}
                  {isPartner(l) && <span className="block text-[10px] font-normal normal-case">aliado</span>}
                </TableHead>
              ))}
              <TableHead className="text-right">Disponible</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((g) => {
              const multi = g.items.length > 1;
              const isOpen = openGroups.has(g.product.id);
              const shown = multi ? (isOpen ? g.items : []) : g.items;
              return (
                <Fragment key={g.product.id}>
                  {multi && (
                    <TableRow className="cursor-pointer bg-muted/40 hover:bg-muted/60" onClick={() => toggleGroup(g.product.id)}>
                      <TableCell>
                        <div className="flex min-w-[200px] items-center gap-2">
                          {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                          <span onClick={(e) => e.stopPropagation()}>
                            <ProductPhotoButton productId={g.product.id} productName={g.product.name} url={g.product.image_url} editable={editable} />
                          </span>
                          <button type="button" className="text-left font-semibold hover:underline" onClick={(e) => {
                              e.stopPropagation();
                              setDetailId(g.product.id);
                            }}>
                            {g.product.name}
                          </button>
                        </div>
                      </TableCell>
                      <TableCell colSpan={columns - 1}>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline">{g.items.length} variantes</Badge>
                          {editable && <BulkApplyButton productId={g.product.id} productName={g.product.name} count={g.items.length} />}
                          {g.product.category && <Badge variant="outline">{g.product.category}</Badge>}
                          <span className="num">{formatQty(g.items.reduce((a, r) => a + r.total.available, 0))} disponibles</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  {shown.map((r) => (
                    <TableRow key={r.variant.id}>
                      <TableCell>
                        <div className={`flex min-w-[200px] items-center gap-2 ${multi ? "pl-8 text-sm text-muted-foreground" : "font-medium"}`}>
                          {!multi && <ProductPhotoButton productId={r.product.id} productName={r.product.name} url={r.product.image_url} editable={editable} />}
                          <button type="button" className="text-left hover:underline" onClick={() => setDetailId(r.product.id)} title="Ver detalle">
                            {multi ? variantLabel(r.variant.options) : r.product.name}
                            {!multi && r.product.brand && <span className="ml-2 text-xs text-muted-foreground">{r.product.brand}</span>}
                          </button>
                          {editable && <CostHistoryButton variantId={r.variant.id} name={multi ? `${r.product.name} ${variantLabel(r.variant.options)}` : r.product.name} currency={currency} />}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {editable ? (
                          <InlineText value={r.variant.sku ?? ""} placeholder="—" onSave={(v) => saveVariant(r.variant.id, { sku: v || null })} />
                        ) : (
                          r.variant.sku ?? "—"
                        )}
                      </TableCell>
                      <MoneyCell editable={editable} value={r.variant.regular_price} onSave={(n) => savePrice(r, n)} currency={currency} />
                      <TableCell>
                        <TaxPicker
                          editable={editable}
                          value={r.product.tax_rate_id}
                          rates={taxRates}
                          onChange={(id) =>
                            updProduct.mutate(
                              { id: r.product.id, patch: { tax_rate_id: id } },
                              { onError: (err) => toast.error("No se pudo cambiar el IVA", { description: err.message }) },
                            )
                          }
                        />
                      </TableCell>
                      <TableCell className="num whitespace-nowrap text-right font-semibold">
                        {(() => {
                          const net = r.variant.price ?? r.variant.regular_price;
                          const offer = r.variant.price != null && r.variant.regular_price != null && Number(r.variant.price) < Number(r.variant.regular_price);
                          return net == null ? (
                            "—"
                          ) : (
                            <>
                              {formatMoney(withTax(Number(net), productTaxRate(r.product.tax_rate_id, taxRates)), currency)}
                              {offer && <span className="block text-[10px] font-normal text-primary">en oferta</span>}
                            </>
                          );
                        })()}
                      </TableCell>
                      <MoneyCell editable={editable} value={r.variant.cost} onSave={(n) => saveVariant(r.variant.id, { cost: n })} currency={currency} />
                      {activeLocations.map((l) => (
                        <TableCell key={l.id} className="num text-right">
                          {formatQty(r.stockAt(l.id))}
                        </TableCell>
                      ))}
                      <TableCell className="num text-right font-semibold">{formatQty(r.total.available)}</TableCell>
                      <TableCell>
                        {r.blockers.length === 0 ? (
                          <Badge className="whitespace-nowrap">Lista para vender</Badge>
                        ) : (
                          <div className="flex max-w-[220px] flex-wrap gap-1">
                            {r.blockers.map((b) => (
                              <Badge key={b} variant="outline" className="whitespace-nowrap text-[10px]">
                                {SALE_BLOCK_LABEL[b]}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              );
            })}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={columns} className="py-10 text-center text-muted-foreground">
                  {isLoading ? "Cargando inventario…" : rows.length === 0 ? "Todavía no hay productos." : "No hay resultados con estos filtros."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <NewProductDialog open={creating} onOpenChange={setCreating} currency={currency} />
      <ProductDetailSheet
        rows={detailId ? rows.filter((r) => r.product.id === detailId) : []}
        locations={locations}
        taxRates={taxRates}
        currency={currency}
        editable={editable}
        onClose={() => setDetailId(null)}
      />
    </AppShell>
  );
}

function uniq(values: (string | null)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => Boolean(v)))).sort((a, b) => a.localeCompare(b));
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="rounded-surface p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="num text-2xl font-bold">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </Card>
  );
}

function Picker({ value, onChange, allLabel, options }: { value: string; onChange: (v: string) => void; allLabel: string; options: { value: string; label: string }[] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={allLabel}>
        <SelectValue placeholder={allLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function InlineText({ value, placeholder, onSave }: { value: string; placeholder: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  return (
    <Input
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft.trim() !== value && onSave(draft.trim())}
      className="h-8 min-w-[110px] text-xs"
    />
  );
}

/** IVA del producto: el del negocio por defecto u otra tasa activa (exento, 8 %…). */
function TaxPicker({
  editable,
  value,
  rates,
  onChange,
}: {
  editable: boolean;
  value: string | null;
  rates: { id: string; name: string; rate: number; is_default: boolean; is_active: boolean }[];
  onChange: (id: string | null) => void;
}) {
  const fallback = rates.find((t) => t.is_default);
  const current = value ? rates.find((t) => t.id === value) : undefined;
  const label = current ? `${current.rate}%` : fallback ? `${fallback.rate}%` : "0%";
  if (!editable) return <span className="num text-xs">{label}</span>;
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
      aria-label="IVA del producto"
    >
      <option value="">Por defecto{fallback ? ` · ${fallback.rate}%` : ""}</option>
      {rates
        .filter((t) => (t.is_active && !t.is_default) || t.id === value)
        .map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} · {t.rate}%
          </option>
        ))}
    </select>
  );
}

function MoneyCell({ editable, value, onSave, currency }: { editable: boolean; value: number | null; onSave: (n: number | null) => void; currency: string }) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  if (!editable) {
    return <TableCell className="num text-right">{value == null ? "—" : formatMoney(value, currency)}</TableCell>;
  }
  return (
    <TableCell className="text-right">
      <Input
        value={draft}
        inputMode="decimal"
        placeholder="—"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const t = draft.trim().replace(",", ".");
          const n = t === "" ? null : Number(t);
          if (n != null && (Number.isNaN(n) || n < 0)) {
            setDraft(value == null ? "" : String(value));
            return;
          }
          if (n !== value) onSave(n);
        }}
        className="ml-auto h-8 w-24 text-right text-xs"
        aria-label="Monto"
      />
    </TableCell>
  );
}
