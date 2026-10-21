/**
 * Carga de un estado de cuenta: perfil del archivo, vista previa y carga con
 * conciliación automática. Se usa en el centro de conciliación y en Conciliar.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { hashFile } from "@/modules/inventory/import/files";
import { formatMoney } from "@/modules/pos/cart";
import type { FinanceAccount } from "../api";
import { formatDay } from "../lib";
import { useBankBatches, useBankProfiles, useImportStatement, type BankProfile, type ImportResult } from "./api";
import { parseBankTable, readBankFile, type BankParseResult } from "./parse";
import ProfileDialog from "./ProfileDialog";
import { importOutcome } from "./labels";

interface Preview {
  fileName: string;
  hash: string;
  result: BankParseResult;
}

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export default function StatementImporter({
  account,
  accounts,
  onAccountChange,
  onImported,
}: {
  account: FinanceAccount;
  /** Con lista de cuentas, se puede cambiar de cuenta desde aquí. */
  accounts?: FinanceAccount[];
  onAccountChange?: (id: string) => void;
  onImported?: (result: ImportResult) => void;
}) {
  const { data: allProfiles = [] } = useBankProfiles();
  const profiles = allProfiles.filter((p) => p.account_id === account.id && p.is_active);
  const [chosenProfile, setChosenProfile] = useState<string | null>(null);
  const profile = profiles.find((p) => p.id === chosenProfile) ?? profiles[0] ?? null;
  const [editing, setEditing] = useState<BankProfile | "new" | null>(null);
  const { data: batches = [] } = useBankBatches(account.id);
  const importStatement = useImportStatement();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reading, setReading] = useState(false);
  const picker = Boolean(accounts && onAccountChange);

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
    if (!preview || !profile) return;
    importStatement.mutate(
      {
        accountId: account.id,
        profileId: profile.id,
        fileName: preview.fileName,
        fileHash: preview.hash,
        rows: preview.result.rows,
        issues: preview.result.errors,
      },
      {
        onSuccess: (r) => {
          toast.success(`${n(r.inserted, "línea nueva", "líneas nuevas")} · ${r.duplicates} ya estaban · ${r.errors} con error`, {
            description: `${importOutcome(r)}${r.fees ? ` · ${n(r.fees, "comisión registrada", "comisiones registradas")}` : ""}`,
            duration: 8000,
          });
          setPreview(null);
          onImported?.(r);
        },
        onError: (err) => toast.error("No se pudo cargar", { description: err.message }),
      },
    );
  };

  return (
    <section className={cn("grid gap-3 rounded-xl border bg-card p-4", picker ? "md:grid-cols-[1fr_1fr_auto]" : "md:grid-cols-[1fr_auto]")}>
      {picker && (
        <div className="space-y-1">
          <Label htmlFor="rc-account">1 · Cuenta</Label>
          <Select
            value={account.id}
            onValueChange={(v) => {
              onAccountChange!(v);
              setChosenProfile(null);
              setPreview(null);
            }}
          >
            <SelectTrigger id="rc-account">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {accounts!.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name} · {a.currency}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor={`rc-profile-${account.id}`}>{picker ? "2 · " : ""}Perfil del archivo</Label>
        <div className="flex gap-2">
          <Select
            value={profile?.id ?? ""}
            onValueChange={(v) => {
              setChosenProfile(v);
              setPreview(null);
            }}
            disabled={profiles.length === 0}
          >
            <SelectTrigger id={`rc-profile-${account.id}`} className="min-w-0 flex-1">
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
          {picker ? "3 · " : ""}
          {reading ? "Leyendo…" : "Subir estado de cuenta"}
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
        <p className="text-xs text-muted-foreground md:col-span-full">
          Esta cuenta no tiene perfil. Crea uno indicando en qué columnas vienen la fecha, la referencia y los montos del archivo de tu banco.
        </p>
      )}

      {preview && (
        <div className="space-y-3 rounded-lg border p-3 md:col-span-full">
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
                    {formatMoney(r.amount, account.currency)}
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

      {editing && (
        <ProfileDialog
          accountId={account.id}
          profile={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            setChosenProfile(id);
            setEditing(null);
          }}
        />
      )}
    </section>
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
