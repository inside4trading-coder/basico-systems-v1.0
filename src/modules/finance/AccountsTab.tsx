import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useTenant } from "@/core/tenant-context";
import { canSupervise } from "@/core/tenant-selection";
import { formatMoney } from "@/modules/pos/cart";
import { parseAmount } from "@/modules/pos/usePosMoney";
import { caracasToday } from "@/modules/reports/dates";
import { usePaymentMethods, useSavePaymentMethod, useTenantSettings } from "@/modules/settings/api";
import { useAccounts, useSaveAccount, type FinanceAccount } from "./api";
import { ACCOUNT_KIND_LABEL, formatDay, type AccountKind } from "./lib";

export default function AccountsTab() {
  const { active } = useTenant();
  const canEdit = canSupervise(active?.role);
  const { data: accounts = [], isLoading } = useAccounts();
  const { data: methods = [] } = usePaymentMethods();
  const saveMethod = useSavePaymentMethod();
  const [editing, setEditing] = useState<FinanceAccount | "new" | null>(null);

  const link = (methodId: string, accountId: string | null) =>
    saveMethod.mutate(
      { id: methodId, account_id: accountId },
      {
        onSuccess: () => toast.success(accountId ? "Método enlazado" : "Método sin cuenta"),
        onError: (err) => toast.error("No se pudo enlazar", { description: err.message }),
      },
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Bancos, cajas, billeteras y procesadores donde entra y sale el dinero.</p>
        {canEdit && (
          <Button size="sm" onClick={() => setEditing("new")}>
            Nueva cuenta
          </Button>
        )}
      </div>
      {isLoading && <p className="mono-cap text-xs text-muted-foreground">Cargando…</p>}
      <ul className="grid gap-2 md:grid-cols-2">
        {accounts.map((a) => (
          <li key={a.id} className={`space-y-1 rounded-xl border bg-card p-3 ${a.is_active ? "" : "opacity-60"}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold">
                  {a.name} {!a.is_active && <Badge variant="secondary">Inactiva</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {ACCOUNT_KIND_LABEL[a.kind]} · {a.currency}
                  {a.institution ? ` · ${a.institution}` : ""}
                  {a.number_hint ? ` · …${a.number_hint}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  Saldo inicial {formatMoney(a.opening_balance, a.currency)} al {formatDay(a.opening_date)}
                </p>
              </div>
              {canEdit && (
                <Button size="sm" variant="outline" onClick={() => setEditing(a)}>
                  Editar
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {!isLoading && accounts.length === 0 && <p className="text-sm text-muted-foreground">Sin cuentas todavía.</p>}

      {accounts.length > 0 && (
        <section className="space-y-2 rounded-xl border bg-card p-4">
          <h2 className="text-sm">Cobros del POS</h2>
          <p className="text-xs text-muted-foreground">
            Elige a qué cuenta entra cada método. Pago móvil, punto, transferencia y similares entran al vender. El efectivo entra al cerrar la caja: lo contado
            menos el fondo. Lo vendido con una financiadora (Cashea u otra) no entra a una cuenta: queda en Por cobrar.
          </p>
          <ul className="divide-y">
            {methods
              .filter((m) => m.is_active && m.kind !== "bnpl")
              .map((m) => {
                const options = accounts.filter((a) => a.currency === m.currency && a.is_active);
                const current = m.account_id;
                return (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="text-sm">
                      {m.name} <span className="mono text-[10px] text-muted-foreground">{m.currency}</span>
                    </span>
                    <Select value={current ?? "none"} onValueChange={(v) => link(m.id, v === "none" ? null : v)} disabled={!canEdit}>
                      <SelectTrigger className="h-9 w-56" aria-label={`Cuenta de ${m.name}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No registrar en Administración</SelectItem>
                        {options.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </li>
                );
              })}
          </ul>
        </section>
      )}

      {editing && <AccountDialog account={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function AccountDialog({ account, onClose }: { account: FinanceAccount | null; onClose: () => void }) {
  const { data: settings } = useTenantSettings();
  const save = useSaveAccount();
  const currencies = settings ? [settings.base_currency, ...(settings.local_currency ? [settings.local_currency] : [])] : ["USD"];
  const [name, setName] = useState(account?.name ?? "");
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? "bank");
  const [currency, setCurrency] = useState(account?.currency ?? currencies[0]);
  const [institution, setInstitution] = useState(account?.institution ?? "");
  const [hint, setHint] = useState(account?.number_hint ?? "");
  const [opening, setOpening] = useState(account ? String(account.opening_balance) : "0");
  const [openingDate, setOpeningDate] = useState(account?.opening_date ?? caracasToday());
  const [isActive, setIsActive] = useState(account?.is_active ?? true);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error("Ponle un nombre");
    save.mutate(
      {
        id: account?.id,
        name: name.trim(),
        kind,
        currency,
        institution: institution.trim() || null,
        number_hint: hint.trim().slice(-4) || null,
        opening_balance: parseAmount(opening),
        opening_date: openingDate,
        is_active: isActive,
      },
      {
        onSuccess: () => {
          toast.success(account ? "Cuenta actualizada" : "Cuenta creada");
          onClose();
        },
        onError: (err) => toast.error("No se pudo guardar", { description: err.message }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{account ? "Editar cuenta" : "Nueva cuenta"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="ac-name">Nombre *</Label>
            <Input id="ac-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Banesco corriente, Caja dólares…" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="ac-kind">Tipo</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as AccountKind)}>
                <SelectTrigger id="ac-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ACCOUNT_KIND_LABEL) as AccountKind[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {ACCOUNT_KIND_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ac-currency">Moneda</Label>
              <Select value={currency} onValueChange={setCurrency} disabled={Boolean(account)}>
                <SelectTrigger id="ac-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {currencies.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="ac-inst">Banco o empresa</Label>
              <Input id="ac-inst" value={institution} onChange={(e) => setInstitution(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ac-hint">Últimos 4 dígitos</Label>
              <Input id="ac-hint" inputMode="numeric" maxLength={4} value={hint} onChange={(e) => setHint(e.target.value.replace(/\D/g, ""))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="ac-opening">Saldo inicial</Label>
              <Input id="ac-opening" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} className="num" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ac-opening-date">Al día</Label>
              <Input id="ac-opening-date" type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">El saldo cuenta los movimientos desde esa fecha. La moneda no se cambia después de crear la cuenta.</p>
          {account && (
            <label className="flex items-center justify-between gap-2 text-sm">
              Activa
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </label>
          )}
          <Button type="submit" className="h-11 w-full" disabled={save.isPending}>
            Guardar
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
