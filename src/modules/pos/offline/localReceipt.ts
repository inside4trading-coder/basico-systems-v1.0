/**
 * Nota de entrega provisional de una venta cobrada sin conexión. Se arma con
 * la misma cuenta que la vista previa del carrito (igual a la del servidor) y
 * la tasa que el dispositivo tenía guardada; el número definitivo llega al
 * sincronizar.
 */
import type { SaleReceipt } from "../api";
import { cartTotals, igtfOf, round2, toBase, type CartLine, type MoneySettings, type PaymentDraft, type PaymentMethodLike } from "../cart";
import { provisionalNumber } from "./queue";

export interface LocalReceiptInput {
  key: string;
  soldAt: string;
  lines: CartLine[];
  cartDiscount: number;
  pricesIncludeTax: boolean;
  payments: PaymentDraft[];
  methods: (PaymentMethodLike & { name: string })[];
  money: MoneySettings;
  change: { currency: string; amount: number } | null;
  customer: { name?: string; doc?: string } | null;
  note: string | null;
}

export function buildLocalReceipt(input: LocalReceiptInput): SaleReceipt {
  const { money } = input;
  const totals = cartTotals(input.lines, input.cartDiscount, input.pricesIncludeTax);
  const payments = input.payments.map((p) => {
    const m = input.methods.find((x) => x.id === p.methodId);
    const base = m ? (toBase(p.amount, m.currency, money) ?? 0) : 0;
    return {
      method_name: m?.name ?? "Pago",
      currency: m?.currency ?? money.baseCurrency,
      amount: p.amount,
      amount_base: base,
      igtf_base: m ? igtfOf(base, m, money) : 0,
      reference: p.reference ?? null,
      bank: p.bank ?? null,
    };
  });
  const changeBase = input.change ? (toBase(input.change.amount, input.change.currency, money) ?? 0) : 0;

  return {
    id: input.key,
    number: provisionalNumber(input.key),
    status: "pending",
    sold_at: input.soldAt,
    base_currency: money.baseCurrency,
    local_currency: money.localCurrency,
    rate: money.rate,
    prices_include_tax: input.pricesIncludeTax,
    subtotal: totals.subtotal,
    discount_total: totals.discount,
    tax_total: totals.tax,
    total: totals.total,
    igtf_total: round2(payments.reduce((a, p) => a + p.igtf_base, 0)),
    paid_total: round2(payments.reduce((a, p) => a + p.amount_base, 0)),
    change_total: changeBase,
    customer_name: input.customer?.name || null,
    customer_doc: input.customer?.doc || null,
    note: input.note,
    items: input.lines.map((l, i) => {
      const options = Object.values(l.options).join(" · ");
      const t = totals.lines[i];
      return {
        line: i + 1,
        description: options ? `${l.name} — ${options}` : l.name,
        sku: l.sku,
        qty: l.qty,
        unit_price: l.price,
        discount: round2(t.discount + t.cartShare),
        tax_rate: l.taxRate,
        line_total: t.total,
      };
    }),
    payments,
  };
}
