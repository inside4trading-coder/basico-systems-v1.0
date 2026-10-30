/**
 * Tarjetas de producto del POS: foto (o ícono), nombre, PVP en moneda base y
 * en bolívares a la tasa del momento, y lo que queda en la sede. Con el
 * buscador vacío se muestra el catálogo de la sede, lo más vendido primero y
 * por categoría. Portado de PosCatalog.tsx (basicosystems@f551478b).
 */
import { useState } from "react";
import { Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePosCatalog, type PosHit } from "./api";
import { formatMoney, formatQty, fromBase, shelfPrice, type MoneySettings } from "./cart";

export function ProductCard({
  hit,
  money,
  baseCurrency,
  pricesIncludeTax,
  onPick,
}: {
  hit: PosHit;
  money: MoneySettings | null;
  baseCurrency: string;
  pricesIncludeTax: boolean;
  onPick: (hit: PosHit) => void;
}) {
  const pvp = hit.price === null ? null : shelfPrice(Number(hit.price), hit.tax_rate, pricesIncludeTax);
  const local = pvp !== null && money?.localCurrency ? fromBase(pvp, money.localCurrency, money) : null;
  const details = [Object.values(hit.options ?? {}).join(" · "), hit.brand, hit.sku].filter(Boolean).join(" · ");
  const partner = hit.available <= 0 && hit.partner && hit.partner.available > 0 ? hit.partner : null;
  return (
    <button
      type="button"
      onClick={() => onPick(hit)}
      disabled={hit.available <= 0 && !partner}
      className="flex h-full w-full flex-col overflow-hidden rounded-xl border bg-card text-left transition-colors hover:border-primary disabled:opacity-50"
    >
      <div className={cn("grid w-full place-items-center bg-muted", hit.image_url ? "aspect-[4/3]" : "h-14")}>
        {hit.image_url ? (
          <img src={hit.image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <Package className="h-6 w-6 text-muted-foreground/60" aria-hidden />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <p className="line-clamp-2 text-sm font-semibold leading-tight">{hit.product_name}</p>
        {details && <p className="truncate text-[11px] text-muted-foreground">{details}</p>}
        <div className="mt-auto flex items-end justify-between gap-2 pt-1">
          <div>
            {pvp === null ? (
              <p className="num font-bold">Sin precio</p>
            ) : local !== null && money?.localCurrency ? (
              <>
                <p className="num font-bold">{formatMoney(local, money.localCurrency)}</p>
                <p className="num text-[11px] text-muted-foreground">{formatMoney(pvp, baseCurrency)}</p>
              </>
            ) : (
              <p className="num font-bold">{formatMoney(pvp, baseCurrency)}</p>
            )}
          </div>
          {partner ? (
            <span className="num whitespace-nowrap text-right text-[11px] font-medium text-primary">
              Encargo
              <br />
              {partner.name}: {formatQty(partner.available)}
            </span>
          ) : (
            <span className={cn("num whitespace-nowrap text-[11px]", hit.available <= 0 ? "text-destructive" : "text-muted-foreground")}>
              {formatQty(hit.available)} disp.
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

export function ProductGrid({ children }: { children: React.ReactNode }) {
  return <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">{children}</ul>;
}

/** Catálogo de la sede con el buscador vacío. Necesita conexión. */
export function CatalogPanel({
  locationId,
  online,
  money,
  baseCurrency,
  pricesIncludeTax,
  onPick,
}: {
  locationId: string;
  online: boolean;
  money: MoneySettings | null;
  baseCurrency: string;
  pricesIncludeTax: boolean;
  onPick: (hit: PosHit) => void;
}) {
  const [category, setCategory] = useState<string | null>(null);
  const { data, isLoading, error } = usePosCatalog(locationId, category, online);

  if (!online) return <p className="text-sm text-muted-foreground">Sin conexión: busca por nombre o escanea el código.</p>;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  if (isLoading && !data) return <p className="mono-cap text-xs text-muted-foreground">Cargando productos…</p>;
  const items = data?.items ?? [];
  const categories = data?.categories ?? [];

  return (
    <div className="space-y-3">
      {categories.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Categorías">
          {[null, ...categories].map((c) => (
            <button
              key={c ?? "todo"}
              type="button"
              onClick={() => setCategory(c)}
              aria-pressed={category === c}
              className={cn(
                "whitespace-nowrap rounded-full border px-3 py-1 text-sm",
                category === c ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary",
              )}
            >
              {c ?? "Más vendidos"}
            </button>
          ))}
        </div>
      )}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay productos con existencia en esta sede.</p>
      ) : (
        <ProductGrid>
          {items.map((h) => (
            <li key={h.variant_id}>
              <ProductCard hit={h} money={money} baseCurrency={baseCurrency} pricesIncludeTax={pricesIncludeTax} onPick={onPick} />
            </li>
          ))}
        </ProductGrid>
      )}
    </div>
  );
}
