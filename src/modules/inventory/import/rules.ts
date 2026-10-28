/**
 * Reglas de una hoja al importar: lo que el usuario decide además del cruce
 * de columnas. Todo se aplica en el navegador antes de mandar las filas.
 */

export interface ImportRules {
  /** Genera un SKU cuando la fila no trae o repite el de otra fila. */
  autoSku: boolean;
  skuPrefix: string;
  /** Campo propio donde se guarda el código original de la columna SKU (si se repite). */
  keepCodeAs: string | null;
  /** El precio y la oferta del archivo ya traen IVA: se les quita. */
  pricesIncludeTax: boolean;
  /** Las filas sin nombre que no son de un producto existente se saltan en vez de bloquearse. */
  skipNoName: boolean;
  /** Valores para las celdas vacías de productos nuevos. */
  defaults: { brand?: string; category?: string; unit?: string };
}

export const DEFAULT_RULES: ImportRules = {
  autoSku: true,
  skuPrefix: "P-",
  keepCodeAs: null,
  pricesIncludeTax: false,
  skipNoName: true,
  defaults: {},
};

/** Sin ninguna regla: el comportamiento estricto de antes. */
export const NO_RULES: ImportRules = { ...DEFAULT_RULES, autoSku: false, skipNoName: false };

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Precio sin IVA a partir de uno con IVA (rate en %), redondeado como se guarda. */
export function netFromGross(gross: number, rate: number): number {
  return round2(gross / (1 + rate / 100));
}

/**
 * Generador de SKU: prefijo + consecutivo de 5 cifras, siguiente al mayor que
 * ya exista con ese prefijo y sin chocar con ninguno de `taken`.
 */
export function skuGenerator(prefix: string, taken: Iterable<string>) {
  const used = new Set(Array.from(taken, (s) => s.toLocaleUpperCase("es")));
  const p = prefix.trim().toLocaleUpperCase("es");
  const pattern = new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)$`);
  let n = 0;
  for (const sku of used) {
    const m = pattern.exec(sku);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return () => {
    let sku: string;
    do {
      n += 1;
      sku = `${prefix.trim()}${String(n).padStart(5, "0")}`;
    } while (used.has(sku.toLocaleUpperCase("es")));
    used.add(sku.toLocaleUpperCase("es"));
    return sku;
  };
}
