/** Historial de cargas: estados de cuenta de todas las cuentas y reportes de la financiadora. */
import { useAccounts } from "../api";
import { useFinancingEnabled } from "../receivables/api";
import { ALL_ACCOUNTS, useBankBatches, useFinancingImports } from "./api";

const when = (iso: string) => new Date(iso).toLocaleString("es-VE", { timeZone: "America/Caracas", dateStyle: "short", timeStyle: "short" });

interface Row {
  id: string;
  at: string;
  source: string;
  file: string;
  detail: string;
  issues: { row: number; reason: string }[];
}

export default function HistoryPanel() {
  const { data: accounts = [] } = useAccounts();
  const { data: batches = [], isLoading } = useBankBatches(ALL_ACCOUNTS);
  const financing = useFinancingEnabled();
  const { data: fin = [] } = useFinancingImports(financing);

  const rows: Row[] = [
    ...batches.map((b) => ({
      id: b.id,
      at: b.created_at,
      source: accounts.find((a) => a.id === b.account_id)?.name ?? "Cuenta",
      file: b.file_name,
      detail: `${b.rows_new} nuevas · ${b.rows_duplicate} repetidas · ${b.rows_error} con error`,
      issues: b.issues,
    })),
    ...fin.map((f) => ({
      id: f.id,
      at: f.created_at,
      source: f.provider,
      file: f.file_name,
      detail: `${f.rows_total} órdenes · ${f.created_count} nuevas · ${f.updated_count} actualizadas · ${f.linked_count} vinculadas`,
      issues: [],
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  if (isLoading) return <p className="mono-cap text-xs text-muted-foreground">Cargando…</p>;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Aún no hay archivos cargados.</p>;

  return (
    <ul className="divide-y rounded-xl border bg-card">
      {rows.map((r) => (
        <li key={r.id} className="p-3 text-sm">
          <details>
            <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 truncate">
                <span className="font-semibold">{r.source}</span> · {r.file}
              </span>
              <span className="text-xs text-muted-foreground">
                {when(r.at)} · {r.detail}
              </span>
            </summary>
            {r.issues.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">Sin avisos.</p>
            ) : (
              <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto text-xs text-muted-foreground">
                {r.issues.map((i, n) => (
                  <li key={n}>
                    Fila {i.row}: {i.reason}
                  </li>
                ))}
              </ul>
            )}
          </details>
        </li>
      ))}
    </ul>
  );
}
