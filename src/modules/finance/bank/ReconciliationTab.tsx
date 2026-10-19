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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { hashFile } from "@/modules/inventory/import/files";
import { formatMoney } from "@/modules/pos/cart";
import { useAccounts } from "../api";
import { formatDay } from "../lib";
import { useAutoreconcile, useBankBatches, useBankLines, useBankProfiles, useImportStatement, type BankLine, type BankProfile, type LineStatus } from "./api";
import FeesPanel from "./FeesPanel";
import { LINE_STATUS_LABEL } from "./labels";
import LineSheet from "./LineSheet";
import { parseBankTable, readBankFile, type BankParseResult } from "./parse";
import ProfileDialog from "./ProfileDialog";

type Filter = "review" | LineStatus;
const FILTER_LABEL: Record<Filter, string> = {
  review: "Por revisar",
  unmatched: "Sin identificar",
  possible: "Posibles",
  matched: "Conciliadas",
  ignored: "Ignoradas",
};
const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const outcome = (r: { auto_matched: number; possible: number; unmatched: number }) =>
  `${n(r.auto_matched, "conciliada sola", "conciliadas solas")} · ${n(r.possible, "posible", "posibles")} · ${r.unmatched} sin identificar`;

const matchesFilter = (l: BankLine, f: Filter) => (f === "review" ? l.status === "unmatched" || l.status === "possible" : l.status === f);

const STATUS_CLASS: Record<LineStatus, string> = {
  unmatched: "border-destructive/40 text-destructive",
  possible: "border-amber-500/50 text-amber-700 dark:text-amber-400",
  matched: "border-emerald-500/50 text-emerald-700 dark:text-emerald-400",
  ignored: "text-muted-foreground",
};

interface Preview {
  fileName: string;
  hash: string;
  result: BankParseResult;
}

export default function ReconciliationTab() {
  const { data: accounts = [] } = useAccounts();
  const usable = accounts.filter((a) => a.is_active);
  const [chosenAccount, setChosenAccount] = useState<string | null>(null);
  const accountId = chosenAccount ?? usable.find((a) => a.kind === "bank")?.id ?? usable[0]?.id ?? null;
  const account = accounts.find((a) => a.id === accountId);
  const { data: allProfiles = [] } = useBankProfiles();
  const profiles = allProfiles.filter((p) => p.account_id === accountId && p.is_active);
  const [chosenProfile, setChosenProfile] = useState<string | null>(null);
  const profile = profiles.find((p) => p.id === chosenProfile) ?? profiles[0] ?? null;
  const [editing, setEditing] = useState<BankProfile | "new" | null>(null);
  const { data: lines = [], isLoading } = useBankLines(accountId);
  const { data: batches = [] } = useBankBatches(accountId);
  const importStatement = useImportStatement();
  const auto = useAutoreconcile();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reading, setReading] = useState(false);
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

  const pickFile = async (file: File) => {
    if (!profile) return;
    setReading(true);
    try {
      const table = await readBankFile(file, profile.sheet_name);
      const result = parseBankTable(table, profile);
      if (result.rowsRead === 0) toast.warning("No se encontraron filas con datos", { description: "Revisa la primera fila con datos del perfil." });
      setPreview({ fileName: file.name, hash: await hashFile(file), result });
      if (batches.some((b) => b.file_name === file.name)) toast.info("Ya cargaste un archivo con ese nombre", { description: "Las líneas repetidas no se duplican." });
    } catch (err) {
      toast.error("No se pudo leer el archivo", { description: (err as Error).message });
      setPreview(null);
    } finally {
      setReading(false);
    }
  };

  const confirmImport = () => {
    if (!preview || !accountId || !profile) return;
    importStatement.mutate(
      {
        accountId,
        profileId: profile.id,
        fileName: preview.fileName,
        fileHash: preview.hash,
        rows: preview.result.rows,
        issues: preview.result.errors,
      },
      {
        onSuccess: (r) => {
          toast.success(`${n(r.inserted, "línea nueva", "líneas nuevas")} · ${r.duplicates} ya estaban · ${r.errors} con error`, {
            description: `${outcome(r)}${r.fees ? ` · ${n(r.fees, "comisión registrada", "comisiones registradas")}` : ""}`,
            duration: 8000,
          });
          setPreview(null);
          setFilter("review");
        },
        onError: (err) => toast.error("No se pudo cargar", { description: err.message }),
      },
    );
  };

  if (usable.length === 0) {
    return <p className="text-sm text-muted-foreground">Crea una cuenta en la pestaña Cuentas para conciliar sus estados de cuenta.</p>;
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-[1fr_1fr_auto]">
        <div className="space-y-1">
          <Label htmlFor="rc-account">1 · Cuenta</Label>
          <Select
            value={accountId ?? ""}
            onValueChange={(v) => {
              setChosenAccount(v);
              setChosenProfile(null);
              setPreview(null);
            }}
          >
            <SelectTrigger id="rc-account">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {usable.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name} · {a.currency}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="rc-profile">2 · Perfil del archivo</Label>
          <div className="flex gap-2">
            <Select
              value={profile?.id ?? ""}
              onValueChange={(v) => {
                setChosenProfile(v);
                setPreview(null);
              }}
              disabled={profiles.length === 0}
            >
              <SelectTrigger id="rc-profile" className="min-w-0 flex-1">
                <SelectValue placeholder="Sin perfiles" />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {profile && (
              <Button type="button" variant="outline" onClick={() => setEditing(profile)}>
                Editar
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => setEditing("new")}>
              Nuevo
            </Button>
          </div>
        </div>
        <div className="flex items-end">
          <Label
            className={cn(
              "inline-flex h-10 w-full cursor-pointer items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90",
              (!profile || reading) && "pointer-events-none opacity-50",
            )}
          >
            3 · {reading ? "Leyendo…" : "Subir estado de cuenta"}
            <input
              type="file"
              className="sr-only"
              accept=".csv,.txt,.xlsx,.xlsm,.xls"
              disabled={!profile || reading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void pickFile(f);
              }}
            />
          </Label>
        </div>
        {profiles.length === 0 && (
          <p className="text-xs text-muted-foreground md:col-span-3">
            Esta cuenta no tiene perfil. Crea uno indicando en qué columnas vienen la fecha, la referencia y los montos del archivo de tu banco.
          </p>
        )}

        {preview && (
          <div className="space-y-3 rounded-lg border p-3 md:col-span-3">
            <p className="font-semibold">{preview.fileName}</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Count label="Filas leídas" value={preview.result.rowsRead} />
              <Count label="Para cargar" value={preview.result.rows.length} strong />
              <Count label="Con error" value={preview.result.errors.length} />
            </div>
            {preview.result.rows.length > 0 && (
              <ul className="divide-y rounded-lg border text-xs">
                {preview.result.rows.slice(0, 5).map((r) => (
                  <li key={r.row} className="flex justify-between gap-2 p-2">
                    <span className="min-w-0 truncate">
                      Fila {r.row} · {formatDay(r.date)} · {r.description ?? "—"}
                      {r.reference ? ` · Ref. ${r.reference}` : ""}
                    </span>
                    <span className="num shrink-0">
                      {r.direction === "in" ? "+" : "−"}
                      {formatMoney(r.amount, account?.currency ?? "")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {preview.result.errors.length > 0 && (
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {preview.result.errors.slice(0, 5).map((e) => (
                  <li key={e.row}>
                    Fila {e.row}: {e.reason}
                  </li>
                ))}
                {preview.result.errors.length > 5 && <li>… y {preview.result.errors.length - 5} más</li>}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">Las líneas que ya estaban cargadas (misma fecha, monto y referencia) no se duplican.</p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={preview.result.rows.length === 0 || importStatement.isPending} onClick={confirmImport}>
                Cargar y conciliar
              </Button>
              <Button variant="outline" onClick={() => setPreview(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </section>

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
                  toast.success("Conciliación automática", { description: outcome(res) });
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

      {batches.length > 0 && (
        <section className="space-y-2 rounded-xl border bg-card p-4">
          <h2 className="text-sm">Cargas de esta cuenta</h2>
          <ul className="divide-y">
            {batches.map((b) => (
              <li key={b.id} className="py-2 text-sm">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-semibold">{b.file_name}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(b.created_at).toLocaleString("es-VE", { timeZone: "America/Caracas", dateStyle: "short", timeStyle: "short" })} · {b.rows_new} nuevas ·{" "}
                      {b.rows_duplicate} repetidas · {b.rows_error} con error
                    </span>
                  </summary>
                  {b.issues.length === 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">Todas las filas se cargaron.</p>
                  ) : (
                    <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto text-xs text-muted-foreground">
                      {b.issues.map((i, n) => (
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
        </section>
      )}

      {editing && accountId && (
        <ProfileDialog
          accountId={accountId}
          profile={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            setChosenProfile(id);
            setEditing(null);
          }}
        />
      )}
      <LineSheet key={opened?.id} line={opened} onClose={() => setOpenId(null)} />
    </div>
  );
}

function Count({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="rounded-lg border p-2">
      <p className="mono-cap text-[10px] text-muted-foreground">{label}</p>
      <p className={cn("num text-lg", strong && "font-bold")}>{value}</p>
    </div>
  );
}
