import { useMemo } from "react";
import { useCurrentRate, useTenantSettings } from "@/modules/settings/api";
import type { MoneySettings } from "./cart";

/** Monedas, tasa vigente e IGTF del negocio, como los usa el carrito. */
export function usePosMoney(): {
  money: MoneySettings | null;
  stale: boolean;
  loading: boolean;
  currencies: string[];
  pricesIncludeTax: boolean;
} {
  const settings = useTenantSettings();
  const rate = useCurrentRate();

  return useMemo(() => {
    const t = settings.data;
    if (!t) return { money: null, stale: false, loading: settings.isLoading || rate.isLoading, currencies: [], pricesIncludeTax: true };
    const money: MoneySettings = {
      baseCurrency: t.base_currency,
      localCurrency: t.local_currency,
      rate: t.local_currency ? (rate.data?.rate ?? null) : null,
      isSpecialTaxpayer: t.is_special_taxpayer,
      igtfRate: t.igtf_rate,
    };
    const currencies = t.local_currency ? [t.base_currency, t.local_currency] : [t.base_currency];
    return { money, stale: Boolean(t.local_currency && (rate.data?.stale ?? true)), loading: rate.isLoading, currencies, pricesIncludeTax: t.prices_include_tax };
  }, [settings.data, settings.isLoading, rate.data, rate.isLoading]);
}

export function parseAmount(value: string): number {
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
