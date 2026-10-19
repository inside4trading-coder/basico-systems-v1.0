/**
 * Reporte de cierre de caja para la impresora térmica, como el "corte" que el
 * cajero entrega con el efectivo. Portado del cierre de SublimeCierres.tsx
 * (basicosystems@f551478b).
 */
import { formatMoney } from "@/modules/pos/cart";
import { formatSaleDate, type PaperWidth } from "@/modules/pos/receipt";
import type { CashClosure } from "./api";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

export function closingHtml(c: CashClosure, businessName: string, baseCurrency: string, width: PaperWidth): string {
  const e = escapeHtml;
  const row = (l: string, r: string, cls = "") => `<div class="row ${cls}"><span>${l}</span><span>${r}</span></div>`;
  const counts = c.counts
    .map(
      (k) => `<p><strong>Efectivo ${e(k.currency)}</strong></p>
${row("Fondo", formatMoney(k.opening, k.currency))}
${row("Esperado", formatMoney(k.expected, k.currency))}
${row("Contado", k.counted === null ? "—" : formatMoney(k.counted, k.currency))}
${row("Diferencia", k.difference === null ? "—" : formatMoney(k.difference, k.currency), k.difference !== null && Math.abs(k.difference) >= 0.01 ? "strong" : "")}`,
    )
    .join("<hr>");
  const methods = c.by_method.map((m) => row(e(m.method), formatMoney(m.amount, m.currency))).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>Cierre ${e(c.number)}</title><style>
@page { size: ${width}mm auto; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; padding: 3mm; width: ${width}mm; font: ${width === 58 ? 10 : 11}px/1.35 ui-monospace, "JetBrains Mono", monospace; color: #000; }
h1 { font-size: 1.2em; margin: 0; text-align: center; }
p { margin: 4px 0; }
.center { text-align: center; }
.row { display: flex; justify-content: space-between; gap: 6px; }
.row span:last-child { white-space: nowrap; text-align: right; }
.strong { font-weight: 700; }
hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
</style></head><body>
<p class="center"><strong>CIERRE DE CAJA</strong></p>
<h1>${e(businessName)}</h1>
<p class="center">${e(c.location_name)} · ${e(c.register_name)}</p>
<hr>
${row(`<strong>${e(c.number)}</strong>`, c.status === "closed" ? "Cerrada" : "Abierta")}
${row("Apertura", e(formatSaleDate(c.opened_at)))}
${c.opened_by ? row("Abrió", e(c.opened_by)) : ""}
${c.closed_at ? row("Cierre", e(formatSaleDate(c.closed_at))) : ""}
${c.closed_by ? row("Cerró", e(c.closed_by)) : ""}
<hr>
${row("Ventas", String(c.sales_count))}
${row("Total vendido", formatMoney(c.sales_total, baseCurrency), "strong")}
${c.offline_count > 0 ? row("Sin conexión", String(c.offline_count)) : ""}
<hr>
${methods || "<p>Sin cobros</p>"}
<hr>
${counts}
${c.closing_note ? `<hr><p>${e(c.closing_note)}</p>` : ""}
<hr>
<p class="center">Firma cajero ____________</p>
<p class="center">Firma encargado __________</p>
</body></html>`;
}
