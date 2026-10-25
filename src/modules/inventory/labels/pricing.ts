/** Precio de la etiqueta: el PVP (sin IVA + IVA del producto), en la moneda base y opcionalmente en bolívares. */
import { formatMoney } from "@/modules/pos/cart";
import { productTaxRate, withTax } from "@/core/tax";
import { useCurrentRate, useTaxRates, useTenantSettings } from "@/modules/settings/api";

export function usePvp() {
  const { data: settings } = useTenantSettings();
  const { data: rate } = useCurrentRate();
  const { data: taxRates = [] } = useTaxRates();
  const base = settings?.base_currency ?? "USD";
  const local = settings?.local_currency ?? null;
  return (net: number | null | undefined, taxRateId: string | null | undefined) => {
    const n = Number(net ?? 0);
    const price = settings?.prices_include_tax ? n : withTax(n, productTaxRate(taxRateId ?? null, taxRates));
    return {
      price: price > 0 ? formatMoney(price, base) : "",
      priceLocal: local && rate?.rate && price > 0 ? formatMoney(price * rate.rate, local) : null,
    };
  };
}
