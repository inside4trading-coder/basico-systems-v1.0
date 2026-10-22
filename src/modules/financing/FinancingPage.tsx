/**
 * Módulo de la financiadora (Cashea u otra con el mismo esquema): deuda de los
 * clientes por cuotas, cuenta corriente con la financiadora, carga de sus dos
 * archivos (órdenes y pagos) e historial. Portado de la pantalla Cashea del
 * ERP (AdminCashea.tsx, basicosystems@9cb08cd) en formato SaaS: requiere el
 * módulo del plan y un método de pago de financiadora activo.
 */
import { Link, Navigate } from "react-router-dom";
import AppShell from "@/components/AppShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTenant } from "@/core/tenant-context";
import { useTabParam } from "@/lib/useTabParam";
import HistoryPanel from "@/modules/finance/bank/HistoryPanel";
import { useFinancingEnabled, useFinancingProvider } from "@/modules/finance/receivables/api";
import FinancingFilesPanel from "@/modules/finance/receivables/FinancingFilesPanel";
import ReceivablesTab from "@/modules/finance/receivables/ReceivablesTab";

type Tab = "operations" | "files" | "history";
const TABS: Tab[] = ["operations", "files", "history"];

export default function FinancingPage() {
  const { active, can } = useTenant();
  const [tab, setTab] = useTabParam<Tab>(TABS, "operations");
  const enabled = useFinancingEnabled();
  const provider = useFinancingProvider();
  if (!can("finanzas.operar")) return <Navigate to="/" replace />;

  return (
    <AppShell wide>
      <div>
        <h1 className="text-2xl">{enabled ? provider : "Financiadora"}</h1>
        <p className="text-sm text-muted-foreground">Deuda de los clientes por cuotas y cuenta corriente con {enabled ? provider : "la financiadora"}.</p>
      </div>
      {!enabled ? (
        <div className="space-y-2 rounded-xl border bg-card p-4 text-sm">
          <p>Activa el método de pago de la financiadora para vender con ella en el POS y conciliar sus cuotas.</p>
          {can("config.negocio") && (
            <Link to="/configuracion" className="text-primary underline">
              Ir a Configuración → Métodos de pago
            </Link>
          )}
        </div>
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="space-y-4">
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="operations">Operaciones</TabsTrigger>
            <TabsTrigger value="files">Importar archivos</TabsTrigger>
            <TabsTrigger value="history">Historial</TabsTrigger>
          </TabsList>
          <TabsContent value="operations">
            <ReceivablesTab scope="financing" />
          </TabsContent>
          <TabsContent value="files">
            <FinancingFilesPanel />
          </TabsContent>
          <TabsContent value="history">
            <HistoryPanel financingOnly />
          </TabsContent>
        </Tabs>
      )}
    </AppShell>
  );
}
