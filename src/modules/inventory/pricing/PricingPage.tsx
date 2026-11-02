/**
 * Precios: del costo al PVP con la política del negocio. El listado marca qué
 * precios revisar (costo nuevo, pérdida, margen bajo, sin fijar) y permite
 * aplicar el sugerido en bloque o la política a todo el inventario. La
 * política se edita en su pestaña.
 */
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatMoney } from "@/core/money";
import { productTaxRate, withTax } from "@/core/tax";
import { useTenant } from "@/core/tenant-context";
import { useTaxRates } from "@/modules/settings/api";
import { useCatalog } from "../api";
import { variantLabel } from "../lib";
import { usePricingPolicy, useSetPrices } from "./api";
import ApplyPolicyDialog from "./ApplyPolicyDialog";
import PolicyTab from "./PolicyTab";
import PriceSheet, { type PriceRow } from "./PriceSheet";
import { DEFAULT_POLICY, pct, PRICE_STATUS_LABEL, priceStatus, profitAt, suggestPrice, type PriceStatus } from "./pricing";

const STATUS_ORDER: PriceStatus[] = ["revisar", "perdida", "margen_bajo", "sin_fijar", "sin_costo", "manual", "fijado"];
const PAGE = 200;

export default function PricingPage() {
  const { active, can } = useTenant();
  const currency = active?.tenant.base_currency ?? "USD";
  const editable = can("catalogo.editar");
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "politica" ? "politica" : "listado";
  const { data: catalog, isLoading } = useCatalog();
  const { data: taxRates = [] } = useTaxRates();
  const { data: policyData } = usePricingPolicy();
  const policy = useMemo(() => policyData ?? { ...DEFAULT_POLICY, saved: false }, [policyData]);
  const setPrices = useSetPrices();

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<PriceStatus | "all">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [applyOpen, setApplyOpen] = useState(false);

  const rows = useMemo(
    () =>
      (catalog?.rows ?? [])
        .filter((r) => r.product.is_active && r.variant.is_active)
        .map((r) => {
          const taxRate = productTaxRate(r.product.tax_rate_id, taxRates);
          const v = r.variant;
          const cost = v.cost == null ? null : Number(v.cost);
          const regular = v.regular_price == null ? null : Number(v.regular_price);
          const price = v.price == null ? null : Number(v.price);
          const pricedCost = v.priced_cost == null ? null : Number(v.priced_cost);
          const locked = !!v.price_locked;
          const row: PriceRow = {
            variantId: v.id,
            name: r.product.name,
            variant: variantLabel(v.options),
            sku: v.sku,
            cost,
            pricedCost,
            regular,
            price,
            taxRate,
            locked,
            status: priceStatus({ cost, priced_cost: pricedCost, regular_price: regular, price, price_locked: locked }, policy),
          };
          const suggestion = suggestPrice(cost, policy, taxRate);
          const profit = cost && regular != null ? profitAt(price ?? regular, cost, policy).pct : null;
          const search = [r.product.name, r.product.brand, v.sku, row.variant].join(" ").toLowerCase();
          return { row, suggestion, profit, search, brand: r.product.brand };
        }),
    [catalog, taxRates, policy],
  );

  const counts = useMemo(() => {
    const m = new Map<PriceStatus, number>();
    for (const r of rows) m.set(r.row.status, (m.get(r.row.status) ?? 0) + 1);
    return m;
  }, [rows]);

  const filtered = rows.filter((r) => {
    if (status !== "all" && r.row.status !== status) return false;
    if (q.trim() && !q.toLowerCase().split(/\s+/).every((w) => r.search.includes(w))) return false;
    return true;
  });
  const shown = filtered.slice(0, limit);
  const applicable = filtered.filter((r) => r.suggestion && selected.has(r.row.variantId));
  const allShownSelected = shown.length > 0 && shown.every((r) => !r.suggestion || selected.has(r.row.variantId));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleShown = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of shown) {
        if (!r.suggestion) continue;
        if (allShownSelected) next.delete(r.row.variantId);
        else next.add(r.row.variantId);
      }
      return next;
    });

  const applySuggested = () =>
    setPrices.mutate(
      { items: applicable.map((r) => ({ variant_id: r.row.variantId, regular_price: r.suggestion!.net, price_locked: false })), reason: "Fijación con la política" },
      {
        onSuccess: (n) => {
          toast.success(`${n} precio${n === 1 ? "" : "s"} fijado${n === 1 ? "" : "s"} con la política`);
          setSelected(new Set());
        },
        onError: (err) => toast.error("No se pudieron fijar", { description: err.message }),
      },
    );

  const openRow = rows.find((r) => r.row.variantId === openId)?.row ?? null;
  const defaultTax = productTaxRate(null, taxRates);

  return (
    <AppShell wide="full">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Precios</h1>
          <p className="text-sm text-muted-foreground">Costo → precio sin IVA → PVP, con la política del negocio</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {editable && policy.saved && <Button onClick={() => setApplyOpen(true)}>Aplicar política a todo</Button>}
          <Button variant="outline" asChild>
            <Link to="/inventario">Volver al inventario</Link>
          </Button>
        </div>
      </div>

      {!policy.saved && (
        <Card className="flex flex-wrap items-center justify-between gap-3 rounded-surface p-4 text-sm">
          <span>
            Aún no hay política de precios. Los sugeridos usan {DEFAULT_POLICY.target_margin} % de ganancia, sin comisiones ni redondeo.
          </span>
          {editable && (
            <Button size="sm" onClick={() => setParams({ tab: "politica" })}>
              Definir política
            </Button>
          )}
        </Card>
      )}

      <Tabs value={tab} onValueChange={(v) => setParams(v === "listado" ? {} : { tab: v })}>
        <TabsList>
          <TabsTrigger value="listado">Listado</TabsTrigger>
          <TabsTrigger value="politica">Política</TabsTrigger>
        </TabsList>

        <TabsContent value="listado" className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={status === "all" ? "default" : "outline"} onClick={() => setStatus("all")}>
              Todos <span className="ml-1 opacity-70">{rows.length}</span>
            </Button>
            {STATUS_ORDER.map((s) => (
              <Button key={s} size="sm" variant={status === s ? "default" : "outline"} onClick={() => setStatus(s)} disabled={!counts.get(s)}>
                {PRICE_STATUS_LABEL[s]} <span className="ml-1 opacity-70">{counts.get(s) ?? 0}</span>
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Input className="max-w-sm" placeholder="Buscar producto, marca o SKU" value={q} onChange={(e) => setQ(e.target.value)} />
            {editable && applicable.length > 0 && (
              <Button onClick={applySuggested} disabled={setPrices.isPending}>
                Aplicar sugerido a {applicable.length}
              </Button>
            )}
          </div>

          <Card className="overflow-x-auto rounded-surface">
            <Table>
              <TableHeader>
                <TableRow>
                  {editable && (
                    <TableHead className="w-10">
                      <Checkbox checked={allShownSelected} onCheckedChange={toggleShown} aria-label="Elegir todos los visibles" />
                    </TableHead>
                  )}
                  <TableHead className="min-w-[260px]">Producto</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Costo</TableHead>
                  <TableHead className="text-right">PVP sugerido</TableHead>
                  <TableHead className="text-right">PVP actual</TableHead>
                  <TableHead className="text-right">Ganancia</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map(({ row, suggestion, profit }) => {
                  const current = row.regular == null ? null : withTax(row.regular, row.taxRate);
                  const offer = row.price != null && row.regular != null && row.price < row.regular ? withTax(row.price, row.taxRate) : null;
                  const differs = suggestion && current != null && suggestion.pvp !== current;
                  return (
                    <TableRow key={row.variantId} className="cursor-pointer" onClick={() => setOpenId(row.variantId)}>
                      {editable && (
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox checked={selected.has(row.variantId)} disabled={!suggestion} onCheckedChange={() => toggle(row.variantId)}
                            aria-label={`Elegir ${row.name}`} />
                        </TableCell>
                      )}
                      <TableCell>
                        <span className="font-medium">{row.name}</span>
                        {row.variant && <span className="block text-xs text-muted-foreground">{row.variant}</span>}
                      </TableCell>
                      <TableCell className="mono text-xs">{row.sku ?? "—"}</TableCell>
                      <TableCell className="num text-right">{row.cost == null ? "—" : formatMoney(row.cost, currency)}</TableCell>
                      <TableCell className={`num text-right ${differs ? "font-semibold text-primary" : ""}`}>
                        {suggestion ? formatMoney(suggestion.pvp, currency) : "—"}
                      </TableCell>
                      <TableCell className="num text-right">
                        {current == null ? "—" : formatMoney(current, currency)}
                        {offer != null && <span className="block text-[10px] text-primary">oferta {formatMoney(offer, currency)}</span>}
                      </TableCell>
                      <TableCell className={`num text-right ${profit != null && profit < 0 ? "text-destructive" : ""}`}>
                        {profit == null ? "—" : `${pct(profit)} %`}
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.status === "fijado" ? "outline" : row.status === "perdida" ? "destructive" : "secondary"} className="whitespace-nowrap">
                          {PRICE_STATUS_LABEL[row.status]}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {shown.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={editable ? 8 : 7} className="py-10 text-center text-muted-foreground">
                      {isLoading ? "Cargando…" : "No hay productos con ese filtro."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
          {filtered.length > shown.length && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => setLimit((l) => l + PAGE)}>
                Ver {Math.min(PAGE, filtered.length - shown.length)} más de {filtered.length - shown.length}
              </Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="politica">
          <PolicyTab policy={policy} editable={editable} currency={currency} taxRate={defaultTax} />
        </TabsContent>
      </Tabs>

      <ApplyPolicyDialog open={applyOpen} onOpenChange={setApplyOpen} />

      <PriceSheet row={openRow} policy={policy} currency={currency} editable={editable} onClose={() => setOpenId(null)} />
    </AppShell>
  );
}
