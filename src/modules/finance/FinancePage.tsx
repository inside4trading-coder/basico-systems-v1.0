/**
 * Administración: saldos, libro de movimientos, obligaciones y cuentas.
 * Portado de src/pages/sublime/admin/SublimeAdminScreens.tsx
 * (basicosystems@f551478b).
 */
import { Navigate } from "react-router-dom";
import AppShell from "@/components/AppShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTenant } from "@/core/tenant-context";
import { canSeeReports } from "@/core/tenant-selection";
import AccountsTab from "./AccountsTab";
import MovementsTab from "./MovementsTab";
import ObligationsTab from "./ObligationsTab";
import SummaryTab from "./SummaryTab";

export default function FinancePage() {
  const { active } = useTenant();
  if (!canSeeReports(active?.role)) return <Navigate to="/" replace />;

  return (
    <AppShell wide>
      <h1 className="text-2xl">Administración</h1>
      <Tabs defaultValue="summary" className="space-y-4">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="summary">Resumen</TabsTrigger>
          <TabsTrigger value="movements">Movimientos</TabsTrigger>
          <TabsTrigger value="obligations">Obligaciones</TabsTrigger>
          <TabsTrigger value="accounts">Cuentas</TabsTrigger>
        </TabsList>
        <TabsContent value="summary">
          <SummaryTab />
        </TabsContent>
        <TabsContent value="movements">
          <MovementsTab />
        </TabsContent>
        <TabsContent value="obligations">
          <ObligationsTab />
        </TabsContent>
        <TabsContent value="accounts">
          <AccountsTab />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
