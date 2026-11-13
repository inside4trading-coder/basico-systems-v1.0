/** Formularios de cuentas por pagar: factura nueva, pago, nota de crédito y proveedores. */
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { formatMoney } from "@/modules/pos/cart";
import { parseAmount } from "@/modules/pos/usePosMoney";
import { caracasToday } from "@/modules/reports/dates";
import { useCurrentRate, useTenantSettings } from "@/modules/settings/api";
import { useCatalog, type FinanceAccount } from "../api";
import { formatDay } from "../lib";
import { splitInstallments } from "../receivables/lib";
import { useCreatePayable, useCreditPayable, usePayPayable, useSaveSupplier, useSuppliers, type Payable, type Supplier } from "./api";
import { addDays, payableLeft } from "./lib";

const MERCHANDISE = "Proveedores";

function Shell({ title, onClose, busy, children, wide }: { title: string; onClose: () => void; busy?: boolean; children: ReactNode; wide?: boolean }) {
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className={wide ? "max-h-[92vh] max-w-lg overflow-y-auto" : "max-h-[92vh] max-w-md overflow-y-auto"}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function Field({ id, label, children, className }: { id: string; label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className ? `space-y-1 ${className}` : "space-y-1"}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function useCurrencies(): string[] {
  const { data: settings } = useTenantSettings();
  return settings ? [settings.base_currency, ...(settings.local_currency ? [settings.local_currency] : [])] : ["USD"];
}

const errorToast = (title: string) => (err: Error) => toast.error(title, { description: err.message });

/* ---------------- Factura nueva ---------------- */

export function NewPayableDialog({ onClose }: { onClose: () => void }) {
  const create = useCreatePayable();
  const { data: suppliers = [] } = useSuppliers();
  const { data: catalog = [] } = useCatalog();
  const currencies = useCurrencies();
  const today = caracasToday();
  const active = suppliers.filter((s) => s.is_active);
  const categories = useMemo(() => {
    const names = catalog.filter((c) => c.kind === "category" && c.direction === "out" && c.is_active).map((c) => c.name);
    return [MERCHANDISE, ...names.filter((x) => x !== MERCHANDISE)];
  }, [catalog]);

  const [supplierId, setSupplierId] = useState("");
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [document, setDocument] = useState("");
  const [control, setControl] = useState("");
  const [issued, setIssued] = useState(today);
  const [currency, setCurrency] = useState(currencies[0]);
  const [amount, setAmount] = useState("");
  const [tax, setTax] = useState("");
  const [category, setCategory] = useState(MERCHANDISE);
  const [count, setCount] = useState("1");
  const [every, setEvery] = useState("30");
  const [firstDue, setFirstDue] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const supplier = suppliers.find((s) => s.id === supplierId);
  const defaultDue = addDays(issued, supplier?.credit_days ?? 0);
  const due = firstDue ?? defaultDue;
  const total = parseAmount(amount);
  const taxValue = tax.trim() ? parseAmount(tax) : null;
  const parts = total > 0 ? splitInstallments(total, Number(count) || 1, due, Number(every) || 30) : [];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!supplierId) return toast.error("Elige el proveedor");
    if (!(total > 0)) return toast.error("Indica el total de la factura");
    if (taxValue !== null && (Number.isNaN(taxValue) || taxValue < 0 || taxValue > total)) return toast.error("El IVA no puede superar el total");
    if (due < issued) return toast.error("El vencimiento no puede ser antes de la emisión");
    create.mutate(
      {
        p: {
          supplier_id: supplierId,
          document: document.trim() || null,
          control_number: control.trim() || null,
          issued_on: issued,
          currency,
          amount: total,
          tax_amount: taxValue,
          category,
          note: note.trim() || null,
          installments: parts,
        },
      },
      {
        onSuccess: () => {
          toast.success("Factura registrada");
          onClose();
        },
        onError: errorToast("No se pudo registrar"),
      },
    );
  };

  return (
    <>
      <Shell title="Nueva cuenta por pagar" onClose={onClose} busy={create.isPending} wide>
        <form onSubmit={submit} className="space-y-3">
          <div className="flex items-end gap-2">
            <Field id="pp-supplier" label="Proveedor *" className="min-w-0 flex-1">
              <Select
                value={supplierId}
                onValueChange={(v) => {
                  setSupplierId(v);
                  setFirstDue(null);
                }}
              >
                <SelectTrigger id="pp-supplier" className="h-11">
                  <SelectValue placeholder={active.length ? "Elige el proveedor" : "Crea el primer proveedor"} />
                </SelectTrigger>
                <SelectContent>
                  {active.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                      {s.credit_days > 0 ? ` · ${s.credit_days} días` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Button type="button" variant="outline" className="h-11" onClick={() => setAddingSupplier(true)}>
              <Plus /> Proveedor
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field id="pp-document" label="N.º de factura">
              <Input id="pp-document" value={document} maxLength={60} onChange={(e) => setDocument(e.target.value)} />
            </Field>
            <Field id="pp-control" label="N.º de control">
              <Input id="pp-control" value={control} maxLength={60} onChange={(e) => setControl(e.target.value)} />
            </Field>
            <Field id="pp-issued" label="Emisión">
              <Input
                id="pp-issued"
                type="date"
                value={issued}
                max={today}
                onChange={(e) => {
                  setIssued(e.target.value);
                  setFirstDue(null);
                }}
              />
            </Field>
            <Field id="pp-currency" label="Moneda">
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="pp-currency">
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
            </Field>
            <Field id="pp-amount" label="Total de la factura *">
              <Input id="pp-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="num" />
            </Field>
            <Field id="pp-tax" label="IVA (opcional)">
              <Input id="pp-tax" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} className="num" />
            </Field>
            <Field id="pp-category" label="Qué se compró" className="col-span-2">
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="pp-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c === MERCHANDISE ? "Mercancía (Proveedores)" : c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="pp-count" label="Cuotas">
              <Input id="pp-count" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
            </Field>
            <Field id="pp-every" label="Cada (días)">
              <Input id="pp-every" inputMode="numeric" value={every} disabled={(Number(count) || 1) <= 1} onChange={(e) => setEvery(e.target.value)} />
            </Field>
            <Field id="pp-due" label={(Number(count) || 1) > 1 ? "Primera cuota vence" : "Vence"} className="col-span-2">
              <Input id="pp-due" type="date" value={due} min={issued} onChange={(e) => setFirstDue(e.target.value)} />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">
            {category === MERCHANDISE
              ? "Mercancía: al pagarla no cuenta como gasto en el resultado; se cuenta como costo al vender."
              : `Al pagarla cuenta como gasto en «${category}».`}
            {supplier && supplier.credit_days > 0 && firstDue === null ? ` Vence a los ${supplier.credit_days} días de crédito del proveedor.` : ""}
          </p>
          {parts.length > 1 && (
            <p className="text-xs text-muted-foreground">{parts.map((p) => `${formatDay(p.due_date)}: ${formatMoney(p.amount, currency)}`).join(" · ")}</p>
          )}
          <Field id="pp-note" label="Nota">
            <Input id="pp-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Button type="submit" className="h-11 w-full" disabled={create.isPending}>
            Registrar factura
          </Button>
        </form>
      </Shell>
      {addingSupplier && (
        <SupplierFormDialog
          supplier={null}
          onClose={() => setAddingSupplier(false)}
          onSaved={(id) => {
            setSupplierId(id);
            setFirstDue(null);
          }}
        />
      )}
    </>
  );
}

/* ---------------- Pago ---------------- */

export function PayDialog({ payable, accounts, onClose }: { payable: Payable; accounts: FinanceAccount[]; onClose: () => void }) {
  const pay = usePayPayable();
  const { data: rate } = useCurrentRate();
  const { data: settings } = useTenantSettings();
  const due = payableLeft(payable);
  const [accountId, setAccountId] = useState((accounts.find((a) => a.currency === payable.currency) ?? accounts[0])?.id ?? "");
  const account = accounts.find((a) => a.id === accountId);
  const otherCurrency = Boolean(account && account.currency !== payable.currency);
  const [amount, setAmount] = useState<string | null>(null);
  const [applied, setApplied] = useState(due.toFixed(2));
  const [date, setDate] = useState(caracasToday());
  const [reference, setReference] = useState("");

  const suggested = (() => {
    if (!account || !otherCurrency) return parseAmount(applied);
    if (!rate?.rate || !settings) return null;
    const v = parseAmount(applied);
    return account.currency === settings.base_currency ? v / rate.rate : v * rate.rate;
  })();
  const amountText = amount ?? (suggested === null || Number.isNaN(suggested) ? "" : suggested.toFixed(2));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = parseAmount(amountText);
    const appliedValue = otherCurrency ? parseAmount(applied) : value;
    if (!accountId || !(value > 0)) return toast.error("Elige la cuenta y el monto");
    if (!(appliedValue > 0)) return toast.error(`Indica cuánto cubre en ${payable.currency}`);
    if (appliedValue > due + 0.005) return toast.error(`El pago supera lo que falta (${formatMoney(due, payable.currency)})`);
    pay.mutate(
      {
        p_payable_id: payable.id,
        p_account_id: accountId,
        p_amount: value,
        p_occurred_on: date,
        p_applied: otherCurrency ? appliedValue : null,
        p_reference: reference.trim() || null,
        p_note: null,
      },
      {
        onSuccess: () => {
          toast.success("Pago registrado");
          onClose();
        },
        onError: errorToast("No se pudo registrar"),
      },
    );
  };

  return (
    <Shell title={`Pagar a ${payable.supplier?.name ?? "proveedor"}`} onClose={onClose} busy={pay.isPending}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-muted-foreground">Falta {formatMoney(due, payable.currency)}. El pago se aplica desde la cuota más vieja.</p>
        <Field id="pay-account" label="Sale de">
          <Select
            value={accountId}
            onValueChange={(v) => {
              setAccountId(v);
              setAmount(null);
            }}
          >
            <SelectTrigger id="pay-account" className="h-11">
              <SelectValue placeholder="Elige la cuenta" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name} · {a.currency}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          {otherCurrency && (
            <Field id="pay-applied" label={`Cubre (${payable.currency})`}>
              <Input id="pay-applied" inputMode="decimal" value={applied} onChange={(e) => setApplied(e.target.value)} className="num h-11" />
            </Field>
          )}
          <Field id="pay-amount" label={`Sale (${account?.currency ?? ""})`}>
            <Input
              id="pay-amount"
              inputMode="decimal"
              value={amountText}
              onChange={(e) => {
                setAmount(e.target.value);
                if (!otherCurrency) setApplied(e.target.value);
              }}
              className="num h-11"
            />
          </Field>
          <Field id="pay-date" label="Fecha">
            <Input id="pay-date" type="date" value={date} max={caracasToday()} onChange={(e) => setDate(e.target.value)} className="h-11" />
          </Field>
        </div>
        {otherCurrency && rate?.rate && (
          <p className="text-xs text-muted-foreground">
            Sugerido a la tasa de hoy ({rate.rate.toLocaleString("es-VE", { maximumFractionDigits: 2 })}). Puedes cambiar lo que sale si el banco
            usó otra.
          </p>
        )}
        <Field id="pay-ref" label="Referencia">
          <Input id="pay-ref" value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} placeholder="N.º de transferencia o recibo" />
        </Field>
        <Button type="submit" className="h-11 w-full" disabled={pay.isPending || accounts.length === 0}>
          Registrar pago
        </Button>
      </form>
    </Shell>
  );
}

/* ---------------- Nota de crédito ---------------- */

export function CreditNoteDialog({ payable, onClose }: { payable: Payable; onClose: () => void }) {
  const credit = useCreditPayable();
  const due = payableLeft(payable);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(caracasToday());
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = parseAmount(amount);
    if (!(value > 0) || value > due + 0.005) return toast.error(`Indica un monto entre 0 y ${formatMoney(due, payable.currency)}`);
    credit.mutate(
      { p_payable_id: payable.id, p_amount: value, p_occurred_on: date, p_reference: reference.trim() || null, p_note: note.trim() || null },
      {
        onSuccess: () => {
          toast.success("Nota de crédito registrada");
          onClose();
        },
        onError: errorToast("No se pudo registrar"),
      },
    );
  };

  return (
    <Shell title="Nota de crédito o descuento" onClose={onClose} busy={credit.isPending}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Baja la deuda sin mover dinero: devoluciones, mercancía dañada o un descuento del proveedor. Falta {formatMoney(due, payable.currency)}.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Field id="cn-amount" label={`Monto (${payable.currency})`}>
            <Input id="cn-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="num h-11" autoFocus />
          </Field>
          <Field id="cn-date" label="Fecha">
            <Input id="cn-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11" />
          </Field>
        </div>
        <Field id="cn-ref" label="N.º de la nota">
          <Input id="cn-ref" value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field id="cn-note" label="Motivo">
          <Input id="cn-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Button type="submit" className="h-11 w-full" disabled={credit.isPending}>
          Registrar nota de crédito
        </Button>
      </form>
    </Shell>
  );
}

/* ---------------- Proveedores ---------------- */

export function SupplierFormDialog({ supplier, onClose, onSaved }: { supplier: Supplier | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const save = useSaveSupplier();
  const [name, setName] = useState(supplier?.name ?? "");
  const [taxId, setTaxId] = useState(supplier?.tax_id ?? "");
  const [phone, setPhone] = useState(supplier?.phone ?? "");
  const [contact, setContact] = useState(supplier?.contact ?? "");
  const [days, setDays] = useState(String(supplier?.credit_days ?? 0));
  const [notes, setNotes] = useState(supplier?.notes ?? "");
  const [isActive, setIsActive] = useState(supplier?.is_active ?? true);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const creditDays = Number(days);
    if (!name.trim()) return toast.error("Indica el nombre");
    if (!Number.isInteger(creditDays) || creditDays < 0 || creditDays > 365) return toast.error("Los días de crédito van de 0 a 365");
    save.mutate(
      { id: supplier?.id, name, tax_id: taxId, phone, contact, credit_days: creditDays, notes, is_active: isActive },
      {
        onSuccess: (id) => {
          toast.success(supplier ? "Proveedor guardado" : "Proveedor creado");
          onSaved?.(id);
          onClose();
        },
        onError: errorToast("No se pudo guardar"),
      },
    );
  };

  return (
    <Shell title={supplier ? "Editar proveedor" : "Nuevo proveedor"} onClose={onClose} busy={save.isPending}>
      <form onSubmit={submit} className="space-y-3">
        <Field id="sup-name" label="Nombre *">
          <Input id="sup-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field id="sup-tax" label="RIF">
            <Input id="sup-tax" value={taxId} maxLength={30} onChange={(e) => setTaxId(e.target.value)} placeholder="J-12345678-9" />
          </Field>
          <Field id="sup-days" label="Días de crédito">
            <Input id="sup-days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
          </Field>
          <Field id="sup-phone" label="Teléfono">
            <Input id="sup-phone" value={phone} maxLength={40} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field id="sup-contact" label="Contacto">
            <Input id="sup-contact" value={contact} maxLength={120} onChange={(e) => setContact(e.target.value)} />
          </Field>
        </div>
        <Field id="sup-notes" label="Notas">
          <Input id="sup-notes" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} placeholder="Banco, condiciones…" />
        </Field>
        {supplier && (
          <div className="flex items-center justify-between rounded-md border p-3">
            <Label htmlFor="sup-active">Activo</Label>
            <Switch id="sup-active" checked={isActive} onCheckedChange={setIsActive} />
          </div>
        )}
        <Button type="submit" className="h-11 w-full" disabled={save.isPending}>
          {supplier ? "Guardar" : "Crear proveedor"}
        </Button>
      </form>
    </Shell>
  );
}

export function SuppliersDialog({ onClose }: { onClose: () => void }) {
  const { data: suppliers = [], isLoading } = useSuppliers();
  const [editing, setEditing] = useState<Supplier | "new" | null>(null);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = suppliers.filter((s) => !needle || [s.name, s.tax_id, s.contact].some((v) => v?.toLowerCase().includes(needle)));

  return (
    <>
      <Shell title="Proveedores" onClose={onClose} wide>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input type="search" aria-label="Buscar proveedor" placeholder="Nombre, RIF o contacto" value={query} onChange={(e) => setQuery(e.target.value)} />
            <Button onClick={() => setEditing("new")}>
              <Plus /> Nuevo
            </Button>
          </div>
          {isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {!isLoading && shown.length === 0 && <p className="text-sm text-muted-foreground">Sin proveedores todavía.</p>}
          <ul className="divide-y rounded-md border">
            {shown.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 p-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {s.name} {!s.is_active && <Badge variant="outline">Inactivo</Badge>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[s.tax_id, s.credit_days > 0 ? `${s.credit_days} días de crédito` : "De contado", s.phone, s.contact].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <Button size="icon" variant="ghost" aria-label={`Editar ${s.name}`} onClick={() => setEditing(s)}>
                  <Pencil className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </Shell>
      {editing && <SupplierFormDialog supplier={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
