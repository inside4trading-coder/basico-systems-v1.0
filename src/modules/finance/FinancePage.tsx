/**
 * Administración: resumen de tesorería, libro de movimientos, obligaciones,
 * cuentas por cobrar, conciliación bancaria, cuentas y catálogo. Portado de src/pages/sublime/admin/SublimeAdminScreens.tsx
 * (basicosystems@f551478b).
 */
import { Navigate } from "react-router-dom";
import AppShell from "@/components/AppShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTenant } from "@/core/tenant-context";
import { canSeeReports } from "@/core/tenant-selection";
import { useTabParam } from "@/lib/useTabParam";
import AccountsTab from "./AccountsTab";
import ReconciliationCenter from "./bank/ReconciliationCenter";
import ReceivablesTab from "./receivables/ReceivablesTab";
import CatalogTab from "./CatalogTab";
import MovementsTab from "./MovementsTab";
import ObligationsTab from "./obligations/ObligationsTab";
import SummaryTab, { type FinanceTab } from "./SummaryTab";

type Tab = "summary" | FinanceTab | "catalog";
const TABS: Tab[] = ["summary", "movements", "obligations", "receivables", "reconciliation", "accounts", "catalog"];

export default function FinancePage() {
  const { active } = useTenant();
  const [tab, setTab] = useTabParam<Tab>(TABS, "summary");
  if (!canSeeReports(active?.role)) return <Navigate to="/" replace />;

  return (
    <AppShell wide>
      <h1 className="text-2xl">Administración</h1>
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="space-y-4">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="summary">Resumen</TabsTrigger>
          <TabsTrigger value="movements">Movimientos</TabsTrigger>
          <TabsTrigger value="obligations">Obligaciones</TabsTrigger>
          <TabsTrigger value="receivables">Por cobrar</TabsTrigger>
          <TabsTrigger value="reconciliation">Conciliación</TabsTrigger>
          <TabsTrigger value="accounts">Cuentas</TabsTrigger>
          <TabsTrigger value="catalog">Categorías</TabsTrigger>
        </TabsList>
        <TabsContent value="summary">
          <SummaryTab onNavigate={setTab} />
        </TabsContent>
        <TabsContent value="movements">
          <MovementsTab />
        </TabsContent>
        <TabsContent value="obligations">
          <ObligationsTab />
        </TabsContent>
        <TabsContent value="receivables">
          <ReceivablesTab />
        </TabsContent>
        <TabsContent value="reconciliation">
          <ReconciliationCenter />
        </TabsContent>
        <TabsContent value="accounts">
          <AccountsTab />
        </TabsContent>
        <TabsContent value="catalog">
          <CatalogTab />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
