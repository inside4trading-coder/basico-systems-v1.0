/**
 * Exportar todos los datos del negocio a un Excel, una hoja por tabla. El
 * cliente es dueño de sus datos: puede llevárselos cuando quiera. Se lee con
 * la sesión del usuario (RLS: solo el negocio activo) y se omite tenant_id.
 */

export interface ExportSheet {
  sheet: string;
  table: string;
  /** Columnas para paginar en orden estable. */
  order: string[];
}

export const EXPORT_SHEETS: ExportSheet[] = [
  { sheet: "Sedes", table: "locations", order: ["id"] },
  { sheet: "Productos", table: "products", order: ["id"] },
  { sheet: "Variantes", table: "variants", order: ["id"] },
  { sheet: "Códigos", table: "product_codes", order: ["id"] },
  { sheet: "Campos propios", table: "attribute_defs", order: ["id"] },
  { sheet: "Valores de campos", table: "product_attribute_values", order: ["id"] },
  { sheet: "Productos relacionados", table: "product_relations", order: ["product_id", "related_product_id", "kind"] },
  { sheet: "Stock", table: "stocks", order: ["id"] },
  { sheet: "Movimientos inventario", table: "inventory_movements", order: ["id"] },
  { sheet: "Impuestos", table: "tax_rates", order: ["id"] },
  { sheet: "Métodos de pago", table: "payment_methods", order: ["id"] },
  { sheet: "Cajas", table: "registers", order: ["id"] },
  { sheet: "Sesiones de caja", table: "cash_sessions", order: ["id"] },
  { sheet: "Conteos de caja", table: "cash_counts", order: ["session_id", "currency"] },
  { sheet: "Movimientos de caja", table: "cash_movements", order: ["id"] },
  { sheet: "Ventas", table: "sales", order: ["id"] },
  { sheet: "Líneas de venta", table: "sale_items", order: ["id"] },
  { sheet: "Pagos de venta", table: "sale_payments", order: ["id"] },
  { sheet: "Devoluciones", table: "sale_returns", order: ["id"] },
  { sheet: "Líneas devueltas", table: "sale_return_items", order: ["id"] },
  { sheet: "Cuentas", table: "finance_accounts", order: ["id"] },
  { sheet: "Libro", table: "finance_movements", order: ["id"] },
  { sheet: "Categorías", table: "finance_catalog_items", order: ["id"] },
  { sheet: "Obligaciones", table: "obligations", order: ["id"] },
  { sheet: "Cuotas obligaciones", table: "obligation_instances", order: ["id"] },
  { sheet: "Por cobrar", table: "receivables", order: ["id"] },
  { sheet: "Cuotas por cobrar", table: "receivable_installments", order: ["id"] },
  { sheet: "Cobros", table: "receivable_collections", order: ["id"] },
  { sheet: "Cuenta financiadoras", table: "provider_ledger", order: ["id"] },
  { sheet: "Banco", table: "bank_statement_lines", order: ["id"] },
  { sheet: "Tasas propias", table: "tenant_rates", order: ["id"] },
];

export const PAGE_SIZE = 1000;
export const MAX_ROWS_PER_SHEET = 100_000;

export type ExportCell = string | number | boolean | null;

const HIDDEN = new Set(["tenant_id"]);

/** Cabeceras (unión de columnas, en orden de aparición) y filas listas para Excel. */
export function toTable(records: Record<string, unknown>[]): { headers: string[]; rows: ExportCell[][] } {
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k) && !HIDDEN.has(k)) {
        seen.add(k);
        headers.push(k);
      }
    }
  }
  const cell = (v: unknown): ExportCell => {
    if (v === null || v === undefined) return null;
    if (typeof v === "number" || typeof v === "boolean") return v;
    if (typeof v === "string") return /^-?\d+(\.\d+)?$/.test(v) && v.length < 16 ? Number(v) : v;
    return JSON.stringify(v);
  };
  return { headers, rows: records.map((r) => headers.map((h) => cell(r[h]))) };
}

/** Nombre del archivo: negocio y fecha, sin caracteres raros. */
export function exportFileName(businessName: string, day: string): string {
  const slug = businessName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${slug || "negocio"}-datos-${day}.xlsx`;
}
