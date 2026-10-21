/**
 * Conciliación bancaria: cargar el estado de cuenta con un perfil, revisar
 * lo que el banco muestra contra el libro y ver el historial de cargas.
 * Portado de SublimeAdminReconciliation y SublimeAdminImports
 * (basicosystems@f551478b).
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/modules/pos/cart";
import { useAccounts } from "../api";
import { formatDay } from "../lib";
import { useAutoreconcile, useBankLines, type BankLine, type LineStatus } from "./api";
import FeesPanel from "./FeesPanel";
import { importOutcome, LINE_STATUS_LABEL } from "./labels";
import LineSheet from "./LineSheet";
import StatementImporter from "./StatementImporter";

type Filter = "review" | LineStatus;
const FILTER_LABEL: Record<Filter, string> = {
  review: "Por revisar",
  unmatched: "Sin identificar",
  possible: "Posibles",
  matched: "Conciliadas",
  ignored: "Ignoradas",
};

const matchesFilter = (l: BankLine, f: Filter) => (f === "review" ? l.status === "unmatched" || l.status === "possible" : l.status === f);

const STATUS_CLASS: Record<LineStatus, string> = {
  unmatched: "border-destructive/40 text-destructive",
  possible: "border-amber-500/50 text-amber-700 dark:text-amber-400",
  matched: "border-emerald-500/50 text-emerald-700 dark:text-emerald-400",
  ignored: "text-muted-foreground",
};

export default function ReconciliationTab() {
  const { data: accounts = [] } = useAccounts();
  const usable = accounts.filter((a) => a.is_active);
  const [chosenAccount, setChosenAccount] = useState<string | null>(null);
  const accountId = chosenAccount ?? usable.find((a) => a.kind === "bank")?.id ?? usable[0]?.id ?? null;
  const account = accounts.find((a) => a.id === accountId);
  const { data: lines = [], isLoading } = useBankLines(accountId);
  const auto = useAutoreconcile();
  const [filter, setFilter] = useState<Filter>("review");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { review: 0, unmatched: 0, possible: 0, matched: 0, ignored: 0 };
    for (const l of lines) {
      c[l.status]++;
      if (l.status === "unmatched" || l.status === "possible") c.review++;
    }
    return c;
  }, [lines]);
  const needle = query.trim().toLowerCase();
  const shown = lines.filter(
    (l) =>
      matchesFilter(l, filter) &&
      (!needle || [l.description, l.reference, l.operation_number, String(l.amount)].some((v) => v?.toLowerCase().includes(needle))),
  );
  const opened = lines.find((l) => l.id === openId) ?? null;

  if (usable.length === 0) {
    return <p className="text-sm text-muted-foreground">Crea una cuenta en la pestaña Cuentas para conciliar sus estados de cuenta.</p>;
  }

  return (
    <div className="space-y-4">
      {account && <StatementImporter account={account} accounts={usable} onAccountChange={setChosenAccount} onImported={() => setFilter("review")} />}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Estado">
          {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
            <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)} aria-pressed={filter === f}>
              {FILTER_LABEL[f]} ({counts[f]})
            </Button>
          ))}
        </div>
        <Input
          type="search"
          aria-label="Buscar en el banco"
          placeholder="Buscar descripción, referencia o monto"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-9 min-w-0 flex-1 basis-48"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!accountId || auto.isPending || counts.review === 0}
          onClick={() =>
            accountId &&
            auto.mutate(
              { p_account_id: accountId },
              {
                onSuccess: (r) => {
                  const res = r as { auto_matched: number; possible: number; unmatched: number };
                  toast.success("Conciliación automática", { description: importOutcome(res) });
                },
                onError: (err) => toast.error("No se pudo conciliar", { description: err.message }),
              },
            )
          }
        >
          Conciliar automáticamente
        </Button>
      </div>

      {isLoading && <p className="mono-cap text-xs text-muted-foreground">Cargando…</p>}
      {!isLoading && lines.length === 0 && <p className="text-sm text-muted-foreground">Aún no hay estados de cuenta cargados en esta cuenta.</p>}
      {!isLoading && lines.length > 0 && shown.length === 0 && (
        <p className="text-sm text-muted-foreground">{filter === "review" && !needle ? "Todo conciliado." : "Ninguna línea coincide."}</p>
      )}
      <ul className="space-y-2">
        {shown.map((l) => (
          <li key={l.id}>
            <button type="button" onClick={() => setOpenId(l.id)} className="flex w-full items-center justify-between gap-2 rounded-xl border bg-card p-3 text-left hover:bg-accent">
              <div className="min-w-0">
                <p className="truncate font-semibold">{l.description ?? "Movimiento del banco"}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDay(l.line_date)}
                  {l.reference ? ` · Ref. ${l.reference}` : ""}
                  {l.operation_number ? ` · Op. ${l.operation_number}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="num font-semibold">
                  {l.direction === "in" ? "+" : "−"}
                  {formatMoney(l.amount, l.currency)}
                </span>
                <Badge variant="outline" className={STATUS_CLASS[l.status]}>
                  {LINE_STATUS_LABEL[l.status]}
                </Badge>
              </div>
            </button>
          </li>
        ))}
      </ul>

      {accountId && account && <FeesPanel accountId={accountId} currency={account.currency} lines={lines} />}


      <LineSheet key={opened?.id} line={opened} onClose={() => setOpenId(null)} />
    </div>
  );
}

