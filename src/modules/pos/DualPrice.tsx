import { cn } from "@/lib/utils";
import { formatMoney, fromBase, type MoneySettings } from "./cart";

/**
 * Monto en bolívares primero y la referencia en divisa al lado, como manda
 * la norma de precios. Sin moneda local o sin tasa, solo la referencia.
 */
export default function DualPrice({
  amount,
  baseCurrency,
  money,
  size = "md",
  className,
}: {
  amount: number;
  baseCurrency: string;
  money: MoneySettings | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const local = money?.localCurrency && money.rate ? fromBase(amount, money.localCurrency, money) : null;
  const main = size === "lg" ? "text-2xl" : size === "sm" ? "text-sm" : "text-base";
  return (
    <span className={cn("inline-flex flex-col leading-tight", className)}>
      {local !== null && money?.localCurrency ? (
        <>
          <span className={cn("num font-bold", main)}>{formatMoney(local, money.localCurrency)}</span>
          <span className="num text-[11px] text-muted-foreground">{formatMoney(amount, baseCurrency)}</span>
        </>
      ) : (
        <span className={cn("num font-bold", main)}>{formatMoney(amount, baseCurrency)}</span>
      )}
    </span>
  );
}
