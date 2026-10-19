/**
 * Orden de los movimientos candidatos para una línea del banco. Portado de
 * src/lib/sublimeReconcile.ts (basicosystems@f551478b): primero el mismo
 * monto, después la fecha más cercana; la referencia igual se marca.
 */
import type { FinanceMovement } from "../api";
import { daysFrom } from "../lib";

/** Igual que app.bank_ref: letras y dígitos, sin ceros a la izquierda. */
export function bankRef(value: string | null | undefined): string {
  return (value ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase().replace(/^0+/, "");
}

export interface LineLike {
  line_date: string;
  amount: number;
  reference: string | null;
  operation_number: string | null;
}

export interface Candidate {
  movement: FinanceMovement;
  sameAmount: boolean;
  sameReference: boolean;
  days: number;
}

export function rankCandidates(line: LineLike, movements: FinanceMovement[]): Candidate[] {
  const refs = [bankRef(line.reference), bankRef(line.operation_number)].filter(Boolean);
  return movements
    .map((m) => ({
      movement: m,
      sameAmount: Math.abs(m.amount - line.amount) < 0.005,
      sameReference: bankRef(m.reference) !== "" && refs.includes(bankRef(m.reference)),
      days: Math.abs(daysFrom(m.occurred_on, line.line_date)),
    }))
    .sort((a, b) => Number(b.sameAmount) - Number(a.sameAmount) || Number(b.sameReference) - Number(a.sameReference) || a.days - b.days);
}
