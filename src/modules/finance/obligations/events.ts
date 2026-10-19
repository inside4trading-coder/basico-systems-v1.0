/**
 * Texto de la bitácora de una obligación. Portado de admin_audit_log y su
 * vista en AdminObligationDetail.tsx (basicosystems@f551478b).
 */
import { formatMoney } from "@/modules/pos/cart";
import type { ObligationEvent } from "../api";
import { FREQUENCY_LABEL, IMPORTANCE_LABEL, OBLIGATION_STATUS_LABEL, formatDay, type Frequency, type Importance, type ObligationStatus } from "../lib";

const FIELD_LABEL: Record<string, string> = {
  name: "nombre",
  category: "categoría",
  counterparty: "a quién se paga",
  amount: "monto",
  currency: "moneda",
  frequency: "frecuencia",
  start_date: "primer vencimiento",
  end_date: "fecha de fin",
  account_id: "cuenta habitual",
  importance: "importancia",
  responsible: "responsable",
  payment_method: "método habitual",
  is_fixed_expense: "gasto fijo",
  notes: "notas",
  status: "estado",
};

function show(field: string, value: unknown, currency: string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "frequency") return FREQUENCY_LABEL[value as Frequency] ?? String(value);
  if (field === "importance") return IMPORTANCE_LABEL[value as Importance] ?? String(value);
  if (field === "status") return OBLIGATION_STATUS_LABEL[value as ObligationStatus] ?? String(value);
  if (field === "amount") return formatMoney(Number(value), currency);
  if (field === "is_fixed_expense") return value ? "sí" : "no";
  if (field.endsWith("_date") && typeof value === "string") return formatDay(value);
  if (field === "account_id") return "otra cuenta";
  return String(value);
}

export function describeEvent(e: ObligationEvent, currency: string): string {
  const d = e.detail as Record<string, unknown>;
  const due = typeof d.due_date === "string" ? formatDay(d.due_date) : "";
  const money = (v: unknown) => (v === null || v === undefined ? "monto variable" : formatMoney(Number(v), currency));
  switch (e.action) {
    case "created":
      return "Creó la obligación";
    case "status_active":
      return "La reactivó";
    case "status_paused":
      return "La pausó";
    case "status_cancelled":
      return "La canceló";
    case "updated":
      return (
        "Cambió " +
        Object.entries(d)
          .map(([k, v]) => {
            const change = v as { from: unknown; to: unknown };
            return `${FIELD_LABEL[k] ?? k}: ${show(k, change.from, currency)} → ${show(k, change.to, currency)}`;
          })
          .join("; ")
      );
    case "instance_added":
      return `Agregó una cuota el ${due} por ${money(d.amount)}`;
    case "instance_edited":
      return `Editó la cuota del ${due}: ${money(d.amount)}`;
    case "instance_paid":
      return `Cuota del ${due} pagada (${money(d.paid_amount)})`;
    case "instance_partial":
      return `Pago parcial en la cuota del ${due}: lleva ${money(d.paid_amount)} de ${money(d.amount)}`;
    case "instance_pending":
      return `La cuota del ${due} quedó pendiente otra vez`;
    case "instance_skipped":
      return `Omitió la cuota del ${due}${d.reason ? `: ${d.reason}` : ""}`;
    case "instance_void":
      return `Anuló la cuota del ${due}${d.reason ? `: ${d.reason}` : ""}`;
    case "instance_proof":
      return `Adjuntó un comprobante a la cuota del ${due}`;
    default:
      return e.action;
  }
}
