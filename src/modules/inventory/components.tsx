/**
 * Piezas compartidas de Inventario y Control, portadas de
 * SublimeControlInventario.tsx (VariantFinder, VariantCard, LocationSelect).
 */
import { useEffect, useState, type RefObject } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScanButton } from "@/core/scanner/CameraScanner";
import { useScanner } from "@/core/scanner/useScanner";
import { lookupCatalog, useLocations, useStockOf } from "./api";
import { formatQty, MATCH_KIND_LABEL, variantLabel, type LookupResult } from "./lib";

export function LocationSelect({
  value,
  onChange,
  placeholder = "Sede",
  exclude,
}: {
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  exclude?: string;
}) {
  const { data: locations = [] } = useLocations();
  const options = locations.filter((l) => l.is_active && l.id !== exclude);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-11">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((l) => (
          <SelectItem key={l.id} value={l.id}>
            {l.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Sede por defecto de los formularios: una tienda que vende, si no cualquier sede que vende, si no la primera activa. */
export function useDefaultLocation(): [string, (id: string) => void] {
  const { data: locations = [] } = useLocations();
  const [value, setValue] = useState("");
  useEffect(() => {
    if (value || locations.length === 0) return;
    const first =
      locations.find((l) => l.is_active && l.sells_in_pos && l.type === "store") ??
      locations.find((l) => l.is_active && l.sells_in_pos) ??
      locations.find((l) => l.is_active);
    if (first) setValue(first.id);
  }, [locations, value]);
  return [value, setValue];
}

/**
 * Buscador para pistola, cámara o texto: Enter busca y una lectura de pistola
 * (con o sin Enter al final) busca sola; un único resultado se elige solo.
 */
export function VariantFinder({
  onPick,
  autoFocus,
  inputRef,
}: {
  onPick: (found: LookupResult | null) => void;
  autoFocus?: boolean;
  inputRef?: RefObject<HTMLInputElement>;
}) {
  const [code, setCode] = useState("");
  const [results, setResults] = useState<LookupResult[]>([]);
  const [busy, setBusy] = useState(false);

  const search = async (raw: string = code) => {
    const query = raw.trim();
    if (!query) return;
    setBusy(true);
    try {
      const list = await lookupCatalog(query);
      if (list.length === 1) {
        onPick(list[0]);
        setResults([]);
        setCode("");
      } else {
        setResults(list);
        onPick(null);
        if (list.length === 0) toast.error("Sin resultados", { description: query });
      }
    } catch (err) {
      toast.error("No se pudo buscar", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const searchScanned = (scanned: string) => {
    setCode("");
    search(scanned);
  };
  useScanner(searchScanned);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          autoFocus={autoFocus}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              search();
            }
          }}
          placeholder="Escanea o escribe: código, SKU, nombre…"
          className="h-12 text-base"
          inputMode="search"
          aria-label="Buscar producto"
        />
        <ScanButton className="h-12 w-12 shrink-0" onScan={searchScanned} />
        <Button className="h-12 w-12 shrink-0" onClick={() => search()} disabled={busy} aria-label="Buscar">
          <Search />
        </Button>
      </div>
      {results.length > 1 && (
        <Card className="max-h-72 divide-y overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.variant_id}
              type="button"
              className="block w-full p-3 text-left hover:bg-muted"
              onClick={() => {
                onPick(r);
                setResults([]);
                setCode("");
              }}
            >
              <p className="text-sm font-bold">{r.product_name}</p>
              <p className="text-xs text-muted-foreground">
                {[r.brand, variantLabel(r.options), r.sku].filter(Boolean).join(" · ") || "Sin datos"}
              </p>
            </button>
          ))}
        </Card>
      )}
    </div>
  );
}

export function VariantCard({ item, locationId }: { item: LookupResult; locationId: string }) {
  const { data: stock } = useStockOf(item.variant_id, locationId);
  const detail = [item.brand, variantLabel(item.options)].filter(Boolean).join(" · ");
  return (
    <Card className="space-y-1 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="font-bold">{item.product_name}</p>
        <Badge variant="outline" className="shrink-0">
          {MATCH_KIND_LABEL[item.match_kind] ?? item.match_kind}
        </Badge>
      </div>
      {detail && <p className="text-sm text-muted-foreground">{detail}</p>}
      <p className="text-xs">
        SKU <b>{item.sku ?? "—"}</b>
      </p>
      <p className="text-sm">
        En esta sede: <b className="num text-lg">{stock ? formatQty(stock.here) : "…"}</b>{" "}
        <span className="text-xs text-muted-foreground">
          {item.unit} · total {stock ? formatQty(stock.total) : "…"}
        </span>
      </p>
    </Card>
  );
}
