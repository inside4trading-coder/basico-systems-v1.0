/**
 * Importar archivos: cada fuente (estado de cuenta de un banco y, si está
 * habilitada, la financiadora) con su estado y su panel de carga.
 * Portado de SublimeAdminImportCenter (basicosystems@9cb08cd).
 */
import { useMemo, useState } from "react";
import { Landmark, Layers } from "lucide-react";
import { useTenant } from "@/core/tenant-context";
import { canManageTeam } from "@/core/tenant-selection";
import { cn } from "@/lib/utils";
import { usePaymentMethods } from "@/modules/settings/api";
import { useAccounts } from "../api";
import FinancingFilesPanel from "../receivables/FinancingFilesPanel";
import { useFinancingEnabled, useFinancingPaymentImports } from "../receivables/api";
import { ALL_ACCOUNTS, useBankBatches, useBankProfiles, useFinancingImports, useImportGuides } from "./api";
import ImportGuide from "./ImportGuide";
import { SOURCE_STATUS_LABEL, bankGuide, lastLoadByAccount, sourceStatus, type SourceStatus } from "./sources";
import StatementImporter from "./StatementImporter";

const STATUS_DOT: Record<SourceStatus, string> = {
  ok: "bg-emerald-500",
  late: "bg-amber-500",
  never: "bg-muted-foreground/40",
};

const FINANCING = "financing";

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("es-VE", { timeZone: "America/Caracas", dateStyle: "short", timeStyle: "short" }) : null;

export default function ImportCenter() {
  const { active } = useTenant();
  const canEdit = canManageTeam(active?.role);
  const { data: accounts = [] } = useAccounts();
  const { data: profiles = [] } = useBankProfiles();
  const { data: batches = [] } = useBankBatches(ALL_ACCOUNTS);
  const financing = useFinancingEnabled();
  const { data: financingImports = [] } = useFinancingImports(financing);
  const { data: paymentImports = [] } = useFinancingPaymentImports(financing);
  const { data: methods = [] } = usePaymentMethods();
  const { data: guides = [] } = useImportGuides();
  const provider = methods.find((m) => m.kind === "bnpl" && m.is_active)?.name ?? "la financiadora";

  const sources = useMemo(() => {
    const last = lastLoadByAccount(batches);
    const banks = accounts
      .filter((a) => a.is_active && (a.kind === "bank" || profiles.some((p) => p.account_id === a.id && p.is_active)))
      .map((a) => ({ id: a.id, name: a.name, kind: "Estado de cuenta", last: last[a.id] ?? null }));
    // Al día solo si están al día los dos archivos: órdenes y pagos.
    const orders = financingImports[0]?.created_at ?? null;
    const payments = paymentImports[0]?.created_at ?? null;
    const finLast = orders && payments ? (orders < payments ? orders : payments) : null;
    const fin = financing ? [{ id: FINANCING, name: provider, kind: "Órdenes y pagos", last: finLast }] : [];
    return [...fin, ...banks];
  }, [accounts, profiles, batches, financing, financingImports, paymentImports, provider]);

  const suggested = sources.find((s) => sourceStatus(s.last) !== "ok")?.id ?? sources[0]?.id ?? null;
  const [chosen, setChosen] = useState<string | null>(null);
  const selected = sources.find((s) => s.id === (chosen ?? suggested)) ?? null;
  const okCount = sources.filter((s) => sourceStatus(s.last) === "ok").length;
  const lastActivity = sources.map((s) => s.last).filter((d): d is string => Boolean(d)).sort().at(-1) ?? null;
  const account = selected && selected.id !== FINANCING ? accounts.find((a) => a.id === selected.id) : undefined;

  if (sources.length === 0) {
    return <p className="text-sm text-muted-foreground">Crea una cuenta bancaria en la pestaña Cuentas para cargar sus estados de cuenta.</p>;
  }

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className={cn("h-2 w-2 rounded-full", okCount === sources.length ? "bg-emerald-500" : "bg-amber-500")} />
        {okCount} de {sources.length} {sources.length === 1 ? "fuente al día" : "fuentes al día"}
        {lastActivity ? ` · última actividad ${when(lastActivity)}` : ""}
      </p>

      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label="Fuentes">
        {sources.map((s, i) => {
          const status = sourceStatus(s.last);
          const Icon = s.id === FINANCING ? Layers : Landmark;
          return (
            <li key={s.id}>
              <button
                type="button"
                aria-pressed={selected?.id === s.id}
                onClick={() => setChosen(s.id)}
                className={cn(
                  "flex h-full w-full flex-col gap-2 rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary",
                  selected?.id === s.id && "border-primary ring-1 ring-primary",
                  status === "never" && "border-dashed",
                )}
              >
                <span className="flex items-center justify-between">
                  <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                  <span className="num text-xs text-muted-foreground">{i + 1}</span>
                </span>
                <span className="font-semibold leading-tight">{s.name}</span>
                <span className="text-[11px] text-muted-foreground">{s.kind}</span>
                <span className="flex items-center gap-1 text-xs">
                  <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[status])} />
                  {SOURCE_STATUS_LABEL[status]}
                  {s.last ? <span className="text-muted-foreground"> · {when(s.last)}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {selected?.id === FINANCING && <FinancingFilesPanel />}
      {account && (
        <div className="space-y-3">
          <ImportGuide guideKey={`account:${account.id}`} guides={guides} defaultSteps={bankGuide(account.name)} canEdit={canEdit} title="¿Dónde obtengo este archivo?" />
          <StatementImporter key={account.id} account={account} />
        </div>
      )}
    </div>
  );
}
