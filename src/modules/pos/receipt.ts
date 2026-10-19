/**
 * Nota de entrega para impresora térmica de 58 u 80 mm.
 *
 * Portado de src/lib/posReceipt.ts (basicosystems@f551478b): se alimenta solo
 * de la venta guardada y usa la tasa con la que se cobró. No es factura fiscal.
 */
import type { SaleReceipt } from "./api";
import { formatMoney, formatQty, round2 } from "./cart";

export type PaperWidth = 58 | 80;

export interface ReceiptHeader {
  businessName: string;
  locationName?: string;
  registerName?: string;
}

const PAPER_KEY = "pos.paper";

export function storedPaper(): PaperWidth {
  try {
    return localStorage.getItem(PAPER_KEY) === "58" ? 58 : 80;
  } catch {
    return 80;
  }
}

export function storePaper(width: PaperWidth) {
  try {
    localStorage.setItem(PAPER_KEY, String(width));
  } catch {
    // Sin almacenamiento: se queda en 80 mm.
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

export function formatSaleDate(iso: string): string {
  return new Date(iso).toLocaleString("es-VE", { timeZone: "America/Caracas", dateStyle: "short", timeStyle: "short" });
}

/** Total equivalente en moneda local con la tasa de la venta. */
export function localTotal(sale: SaleReceipt): number | null {
  if (!sale.local_currency || !sale.rate) return null;
  return round2(sale.total * sale.rate);
}

export function receiptHtml(sale: SaleReceipt, header: ReceiptHeader, width: PaperWidth): string {
  const e = escapeHtml;
  const base = sale.base_currency;
  const row = (left: string, right: string, cls = "") => `<div class="row ${cls}"><span>${left}</span><span>${right}</span></div>`;
  const items = sale.items
    .map((i) => {
      const detail = `${formatQty(i.qty)} × ${formatMoney(i.unit_price, base)}${i.discount > 0 ? ` − ${formatMoney(i.discount, base)}` : ""}`;
      return `<div class="item"><div>${e(i.description)}</div>${row(e(detail), formatMoney(i.line_total, base), "muted")}</div>`;
    })
    .join("");
  const payments = sale.payments
    .map((p) => {
      const extra = [p.bank, p.reference ? `Ref. ${p.reference}` : null].filter(Boolean).join(" · ");
      return row(e(p.method_name) + (extra ? `<br><small>${e(extra)}</small>` : ""), formatMoney(p.amount, p.currency));
    })
    .join("");
  const local = localTotal(sale);

  return `<!doctype html><html><head><meta charset="utf-8"><title>${e(sale.number)}</title><style>
@page { size: ${width}mm auto; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; padding: 3mm; width: ${width}mm; font: ${width === 58 ? 10 : 11}px/1.35 ui-monospace, "JetBrains Mono", monospace; color: #000; }
h1 { font-size: 1.25em; margin: 0; text-align: center; }
.center { text-align: center; }
.row { display: flex; justify-content: space-between; gap: 6px; }
.row span:last-child { white-space: nowrap; text-align: right; }
.muted { color: #333; }
.item { margin: 4px 0; }
.total { font-weight: 700; font-size: 1.15em; }
hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
small { font-size: 0.85em; }
</style></head><body>
<p class="center"><strong>NOTA DE ENTREGA</strong></p>
<h1>${e(header.businessName)}</h1>
${header.locationName ? `<p class="center">${e(header.locationName)}${header.registerName ? ` · ${e(header.registerName)}` : ""}</p>` : ""}
<hr>
${row(`<strong>${e(sale.number)}</strong>`, e(formatSaleDate(sale.sold_at)))}
${sale.customer_name ? row("Cliente", e(sale.customer_name)) : ""}
${sale.customer_doc ? row("Doc.", e(sale.customer_doc)) : ""}
${sale.status !== "completed" ? `<p class="center"><strong>ANULADA</strong></p>` : ""}
<hr>
${items}
<hr>
${row("Subtotal", formatMoney(sale.subtotal, base))}
${sale.discount_total > 0 ? row("Descuento", "−" + formatMoney(sale.discount_total, base)) : ""}
${row(sale.prices_include_tax ? "Impuesto incluido" : "Impuesto", formatMoney(sale.tax_total, base))}
${row("TOTAL", formatMoney(sale.total, base), "total")}
${local !== null && sale.local_currency ? row("Equivale", formatMoney(local, sale.local_currency)) : ""}
${sale.rate && sale.local_currency ? row("Tasa", `${formatMoney(sale.rate, sale.local_currency)} / ${base}`, "muted") : ""}
<hr>
${payments}
${sale.igtf_total > 0 ? row("IGTF incluido", formatMoney(sale.igtf_total, base)) : ""}
${sale.change_total > 0 ? row("Vuelto", formatMoney(sale.change_total, base)) : ""}
${sale.note ? `<hr><p>${e(sale.note)}</p>` : ""}
<hr>
<p class="center"><small>Documento no fiscal</small></p>
</body></html>`;
}

/** Imprime en un iframe oculto: no abre ventanas que el navegador pueda bloquear. */
export function printReceipt(html: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc || !frame.contentWindow) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  const win = frame.contentWindow;
  const done = () => setTimeout(() => frame.remove(), 1000);
  win.addEventListener("afterprint", done, { once: true });
  setTimeout(() => {
    win.focus();
    win.print();
    done();
  }, 50);
}
