/**
 * Perfil de importación de una cuenta: dónde está cada dato en el archivo del
 * banco. Portado de ImportProfileDrawer (SublimeAdminScreens.tsx,
 * basicosystems@f551478b).
 */
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useSaveBankProfile, type BankProfile } from "./api";
import type { AmountSign, DateFormat, DecimalSeparator } from "./parse";

type ColumnKey = "col_date" | "col_time" | "col_reference" | "col_operation" | "col_description" | "col_debit" | "col_credit" | "col_amount" | "col_balance";

const COLUMNS: { key: ColumnKey; label: string; hint?: string }[] = [
  { key: "col_date", label: "Fecha *" },
  { key: "col_reference", label: "Referencia" },
  { key: "col_description", label: "Descripción" },
  { key: "col_debit", label: "Débito (salidas)", hint: "O usa una sola columna de monto" },
  { key: "col_credit", label: "Crédito (entradas)" },
  { key: "col_amount", label: "Monto (una columna)" },
  { key: "col_operation", label: "N.º de operación" },
  { key: "col_time", label: "Hora" },
  { key: "col_balance", label: "Saldo" },
];

const DATE_LABEL: Record<DateFormat, string> = { DMY: "Día/mes/año", MDY: "Mes/día/año", YMD: "Año-mes-día" };
const DECIMAL_LABEL: Record<DecimalSeparator, string> = { comma: "1.234,56 (coma)", dot: "1,234.56 (punto)" };
const SIGN_LABEL: Record<AmountSign, string> = { positive_in: "Positivo = entrada", positive_out: "Positivo = salida" };

export default function ProfileDialog({ accountId, profile, onClose, onSaved }: {
  accountId: string;
  profile: BankProfile | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const save = useSaveBankProfile();
  const [name, setName] = useState(profile?.name ?? "Estado de cuenta");
  const [startRow, setStartRow] = useState(String(profile?.start_row ?? 2));
  const [sheet, setSheet] = useState(profile?.sheet_name ?? "");
  const [cols, setCols] = useState<Record<ColumnKey, string>>(() =>
    Object.fromEntries(COLUMNS.map((c) => [c.key, profile?.[c.key] ?? ""])) as Record<ColumnKey, string>,
  );
  const [dateFormat, setDateFormat] = useState<DateFormat>(profile?.date_format ?? "DMY");
  const [decimal, setDecimal] = useState<DecimalSeparator>(profile?.decimal_separator ?? "comma");
  const [sign, setSign] = useState<AmountSign>(profile?.amount_sign ?? "positive_in");
  const [active, setActive] = useState(profile?.is_active ?? true);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, v.trim() || null])) as Record<ColumnKey, string | null>;
    if (!clean.col_date) return toast.error("Indica la columna de la fecha");
    if (!clean.col_amount && !clean.col_debit && !clean.col_credit) return toast.error("Indica débito y crédito, o una columna de monto");
    const row = Number(startRow);
    if (!Number.isInteger(row) || row < 1 || row > 1000) return toast.error("La fila de inicio va de 1 a 1000");
    save.mutate(
      {
        id: profile?.id,
        account_id: accountId,
        name: name.trim(),
        start_row: row,
        sheet_name: sheet.trim() || null,
        ...clean,
        col_date: clean.col_date,
        date_format: dateFormat,
        decimal_separator: decimal,
        amount_sign: sign,
        is_active: active,
      },
      {
        onSuccess: (id) => {
          toast.success(profile ? "Perfil actualizado" : "Perfil creado");
          onSaved(id);
        },
        onError: (err) => toast.error("No se pudo guardar", { description: err.message }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{profile ? "Editar perfil de importación" : "Nuevo perfil de importación"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Abre el archivo del banco y anota dónde está cada dato. Puedes poner la letra de la columna (A, B…), su número (1 = primera) o el nombre exacto de la cabecera.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2 space-y-1">
              <Label htmlFor="bp-name">Nombre *</Label>
              <Input id="bp-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bp-start">Primera fila con datos</Label>
              <Input id="bp-start" inputMode="numeric" value={startRow} onChange={(e) => setStartRow(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bp-sheet">Hoja (Excel)</Label>
              <Input id="bp-sheet" value={sheet} onChange={(e) => setSheet(e.target.value)} placeholder="La primera" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {COLUMNS.map((c) => (
              <div key={c.key} className="space-y-1">
                <Label htmlFor={`bp-${c.key}`}>{c.label}</Label>
                <Input
                  id={`bp-${c.key}`}
                  value={cols[c.key]}
                  onChange={(e) => setCols((prev) => ({ ...prev, [c.key]: e.target.value }))}
                  placeholder={c.hint ? "—" : ""}
                  className="mono"
                />
              </div>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Choice id="bp-date" label="Fecha" value={dateFormat} onChange={setDateFormat} labels={DATE_LABEL} />
            <Choice id="bp-decimal" label="Números" value={decimal} onChange={setDecimal} labels={DECIMAL_LABEL} />
            <Choice id="bp-sign" label="Una columna de monto" value={sign} onChange={setSign} labels={SIGN_LABEL} />
          </div>
          {profile && (
            <label className="flex items-center justify-between gap-2 text-sm">
              Activo
              <Switch checked={active} onCheckedChange={setActive} />
            </label>
          )}
          <Button type="submit" className="h-11 w-full" disabled={save.isPending}>
            Guardar perfil
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Choice<T extends string>({ id, label, value, onChange, labels }: {
  id: string;
  label: string;
  value: T;
  onChange: (v: T) => void;
  labels: Record<T, string>;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(labels) as T[]).map((k) => (
            <SelectItem key={k} value={k}>
              {labels[k]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
