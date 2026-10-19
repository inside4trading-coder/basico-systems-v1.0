// Lectura de la página del BCV y de montos. Sin dependencias de Deno para
// poder probarlo con vitest (supabase/functions/_shared/bcv.test.ts).

export type Rate = { source: "bcv" | "dolarapi"; base: "USD" | "EUR"; rate: number; effectiveDate: string; raw: unknown };

/**
 * "881,06640000" (BCV: coma decimal, punto de miles) o "881.0664" (DolarAPI,
 * número JSON) → 881.0664. Rechaza valores absurdos.
 */
export function parseRate(text: string): number {
  const t = text.trim();
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  if (!Number.isFinite(n) || n <= 0 || n > 1e9) throw new Error(`Tasa inválida: ${text}`);
  return Math.round(n * 1e6) / 1e6;
}

/** Fecha de Caracas (UTC-4, sin horario de verano) de un instante. */
export function caracasDate(iso: string): string {
  return new Date(new Date(iso).getTime() - 4 * 3600 * 1000).toISOString().slice(0, 10);
}

export function parseBcvHtml(html: string): Rate[] {
  const pick = (id: string) => {
    const block = html.match(new RegExp(`id="${id}"[\\s\\S]*?<strong[^>]*>\\s*([\\d.,]+)\\s*</strong>`, "i"));
    return block ? parseRate(block[1]) : null;
  };
  const date = html.match(/Fecha Valor:[\s\S]*?content="(\d{4}-\d{2}-\d{2})/i)?.[1];
  if (!date) throw new Error("BCV: no encontré la fecha valor");
  const out: Rate[] = [];
  const usd = pick("dolar");
  const eur = pick("euro");
  if (usd) out.push({ source: "bcv", base: "USD", rate: usd, effectiveDate: date, raw: { usd, date } });
  if (eur) out.push({ source: "bcv", base: "EUR", rate: eur, effectiveDate: date, raw: { eur, date } });
  if (out.length === 0) throw new Error("BCV: no encontré las tasas");
  return out;
}
