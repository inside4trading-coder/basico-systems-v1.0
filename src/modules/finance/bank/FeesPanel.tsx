/**
 * Comisiones del banco: frases que las identifican en el estado de cuenta y
 * registro en lote. Portado de BankFeesPanel (AdminBankFees.tsx,
 * basicosystems@f551478b).
 */
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { formatMoney } from "@/modules/pos/cart";
import { formatDay } from "../lib";
import { useApplyFees, useDeleteFeeRule, useFeeMatches, useFeeRules, useSaveFeeRule, type BankLine } from "./api";
import { feeSuggestions } from "./fees";

export default function FeesPanel({ accountId, currency, lines }: { accountId: string; currency: string; lines: BankLine[] }) {
  const { data: rules = [] } = useFeeRules(accountId);
  const rulesKey = rules.map((r) => `${r.id}:${r.phrase}:${r.match}:${r.is_active}`).join("|");
  const { data: matches = [] } = useFeeMatches(accountId, rulesKey);
  const save = useSaveFeeRule();
  const remove = useDeleteFeeRule();
  const apply = useApplyFees();
  const [phrase, setPhrase] = useState("");
  const [match, setMatch] = useState<"starts" | "contains">("starts");
  const [feeType, setFeeType] = useState("Comisión");
  const [showMatches, setShowMatches] = useState(false);
  const suggestions = useMemo(() => feeSuggestions(lines, rules), [lines, rules]);
  const total = matches.reduce((a, m) => a + m.amount, 0);

  const add = (e: FormEvent, value = phrase) => {
    e.preventDefault();
    if (value.trim().length < 2) return;
    save.mutate(
      { account_id: accountId, phrase: value.trim(), match, fee_type: feeType.trim() || "Comisión" },
      {
        onSuccess: () => setPhrase(""),
        onError: (err) => toast.error("No se pudo agregar", { description: err.message }),
      },
    );
  };

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <div>
        <h2 className="text-sm">Comisiones del banco</h2>
        <p className="text-xs text-muted-foreground">
          Frases con las que el banco nombra sus comisiones. Al cargar el estado de cuenta, las salidas que coinciden se registran solas como egreso
          "Comisiones bancarias" ya conciliado.
        </p>
      </div>

      <ul className="space-y-1">
        {rules.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-sm">
            <span className="min-w-0">
              <span className="mono">{r.phrase}</span>
              <span className="text-xs text-muted-foreground">
                {" "}
                · {r.match === "starts" ? "al inicio" : "en cualquier parte"} · {r.fee_type}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <Switch
                checked={r.is_active}
                aria-label={`${r.phrase} activa`}
                onCheckedChange={(v) => save.mutate({ id: r.id, account_id: accountId, is_active: v })}
              />
              <Button size="sm" variant="ghost" onClick={() => remove.mutate(r.id)} disabled={remove.isPending}>
                Quitar
              </Button>
            </span>
          </li>
        ))}
        {rules.length === 0 && <li className="text-xs text-muted-foreground">Sin frases todavía.</li>}
      </ul>

      <form onSubmit={add} className="flex flex-wrap gap-2">
        <Input aria-label="Frase de comisión" placeholder="COM. PAGO MOVIL" value={phrase} onChange={(e) => setPhrase(e.target.value)} className="h-9 min-w-0 flex-1 basis-40" />
        <Select value={match} onValueChange={(v) => setMatch(v as "starts" | "contains")}>
          <SelectTrigger className="h-9 w-40" aria-label="Dónde aparece">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="starts">Al inicio</SelectItem>
            <SelectItem value="contains">En cualquier parte</SelectItem>
          </SelectContent>
        </Select>
        <Input aria-label="Tipo de comisión" placeholder="Tipo" value={feeType} onChange={(e) => setFeeType(e.target.value)} className="h-9 w-36" />
        <Button type="submit" size="sm" disabled={save.isPending || phrase.trim().length < 2}>
          Agregar
        </Button>
      </form>

      {suggestions.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Parecen comisiones y no tienen frase:</p>
          <div className="flex flex-wrap gap-1">
            {suggestions.map((s) => (
              <Button key={s.phrase} size="sm" variant="outline" onClick={(e) => add(e as unknown as FormEvent, s.phrase)}>
                + {s.phrase} ({s.count})
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={matches.length === 0} onClick={() => setShowMatches(!showMatches)}>
          {matches.length} por registrar · {formatMoney(total, currency)}
        </Button>
        <Button
          size="sm"
          disabled={matches.length === 0 || apply.isPending}
          onClick={() =>
            apply.mutate(
              { p_account_id: accountId, p_apply: true },
              {
                onSuccess: (r) => toast.success(`${(r as { applied: number }).applied} comisiones registradas y conciliadas`),
                onError: (err) => toast.error("No se pudo registrar", { description: err.message }),
              },
            )
          }
        >
          Registrar comisiones
        </Button>
      </div>
      {showMatches && (
        <ul className="divide-y rounded-lg border text-xs">
          {matches.map((m) => (
            <li key={m.line_id} className="flex justify-between gap-2 p-2">
              <span className="min-w-0 truncate">
                {formatDay(m.date)} · {m.description} · <span className="text-muted-foreground">{m.fee_type}</span>
              </span>
              <span className="num shrink-0">{formatMoney(m.amount, currency)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
