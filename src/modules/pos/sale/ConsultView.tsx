/**
 * «Solo consultar POS»: catálogo, precios y existencias sin carrito ni cobro.
 * La sesión de caja y el cajero no cambian. Tras 90 s sin actividad vuelve
 * solo a la pantalla de inicio de venta.
 */
import { useCallback, useEffect, useState } from "react";
import { Eye, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PosHit } from "../api";
import type { MoneySettings } from "../cart";
import { CatalogPanel, ProductCard, ProductGrid } from "../ProductCard";
import { CONSULT_IDLE_MS, useIdleTimeout } from "./useIdleTimeout";

export default function ConsultView({
  locationId,
  online,
  money,
  baseCurrency,
  pricesIncludeTax,
  search,
  onFinish,
}: {
  locationId: string;
  online: boolean;
  money: MoneySettings | null;
  baseCurrency: string;
  pricesIncludeTax: boolean;
  search: (q: string) => Promise<{ hits: PosHit[]; local: boolean }>;
  onFinish: () => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PosHit[]>([]);
  const [searching, setSearching] = useState(false);

  const idle = useCallback(() => {
    toast.info("Consulta terminada por inactividad");
    onFinish();
  }, [onFinish]);
  useIdleTimeout(idle, CONSULT_IDLE_MS);

  useEffect(() => {
    const q = query.trim();
    if (!q) return setHits([]);
    if (q.length < 2) return;
    let alive = true;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await search(q);
        if (alive) setHits(r.hits);
      } catch (err) {
        toast.error("No se pudo buscar", { description: (err as Error).message });
      } finally {
        if (alive) setSearching(false);
      }
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, search]);

  // En consulta no se vende: tocar un producto no hace nada más que avisar.
  const look = (hit: PosHit) => toast.info(`${hit.product_name}: modo consulta, no se agrega al carrito`);

  return (
    <section className="space-y-3" aria-label="Consulta de catálogo">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/40 bg-primary/5 p-3">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Eye className="h-4 w-4" /> Modo consulta: precios y existencias, sin vender.
        </p>
        <Button size="sm" onClick={onFinish}>
          <X className="h-4 w-4" /> Terminar consulta
        </Button>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Busca por código, nombre o atributo"
          className="h-12 pl-9 text-base"
          aria-label="Consultar producto"
          autoFocus
        />
      </div>
      {searching && <p className="mono-cap text-xs text-muted-foreground">Buscando…</p>}
      {query.trim() === "" ? (
        <CatalogPanel
          locationId={locationId}
          online={online}
          money={money}
          baseCurrency={baseCurrency}
          pricesIncludeTax={pricesIncludeTax}
          onPick={look}
        />
      ) : (
        <ProductGrid>
          {hits.map((h) => (
            <li key={h.variant_id}>
              <ProductCard hit={h} money={money} baseCurrency={baseCurrency} pricesIncludeTax={pricesIncludeTax} onPick={look} />
            </li>
          ))}
        </ProductGrid>
      )}
    </section>
  );
}
