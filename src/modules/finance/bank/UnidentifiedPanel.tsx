/**
 * Por identificar: líneas de todos los bancos que aún no tienen movimiento en
 * el libro (sin identificar y posibles), la más reciente primero.
 */
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/modules/pos/cart";
import { useAccounts } from "../api";
import { formatDay } from "../lib";
import { ALL_ACCOUNTS, useBankLines } from "./api";
import { LINE_STATUS_LABEL } from "./labels";
import LineSheet from "./LineSheet";

export default function UnidentifiedPanel() {
  const { data: accounts = [] } = useAccounts();
  const { data: lines = [], isLoading } = useBankLines(ALL_ACCOUNTS);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const needle = query.trim().toLowerCase();
  const pending = lines.filter((l) => l.status === "unmatched" || l.status === "possible");
  const shown = pending.filter(
    (l) =>
      !needle ||
      [l.description, l.reference, l.operation_number, String(l.amount), accounts.find((a) => a.id === l.account_id)?.name].some((v) =>
        v?.toLowerCase().includes(needle),
      ),
  );
  const opened = lines.find((l) => l.id === openId) ?? null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">
          {pending.length} {pending.length === 1 ? "línea" : "líneas"} del banco sin movimiento en el libro.
        </p>
        <Input
          type="search"
          aria-label="Buscar por identificar"
          placeholder="Descripción, referencia, monto o cuenta"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-9 min-w-0 flex-1 basis-48"
        />
      </div>
      {isLoading && <p className="mono-cap text-xs text-muted-foreground">Cargando…</p>}
      {!isLoading && pending.length === 0 && <p className="text-sm text-muted-foreground">Todo identificado.</p>}
      <ul className="space-y-2">
        {shown.map((l) => (
          <li key={l.id}>
            <button type="button" onClick={() => setOpenId(l.id)} className="flex w-full items-center justify-between gap-2 rounded-xl border bg-card p-3 text-left hover:bg-accent">
              <div className="min-w-0">
                <p className="truncate font-semibold">{l.description ?? "Movimiento del banco"}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDay(l.line_date)} · {accounts.find((a) => a.id === l.account_id)?.name ?? "Cuenta"}
                  {l.reference ? ` · Ref. ${l.reference}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="num font-semibold">
                  {l.direction === "in" ? "+" : "−"}
                  {formatMoney(l.amount, l.currency)}
                </span>
                <Badge variant="outline">{LINE_STATUS_LABEL[l.status]}</Badge>
              </div>
            </button>
          </li>
        ))}
      </ul>
      <LineSheet key={opened?.id} line={opened} onClose={() => setOpenId(null)} />
    </div>
  );
}
