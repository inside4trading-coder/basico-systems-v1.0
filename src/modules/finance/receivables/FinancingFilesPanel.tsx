/**
 * Los dos archivos de la financiadora, cada uno con su guía: 1 · órdenes y
 * cuotas, 2 · pagos recibidos. Se usa en el módulo de la financiadora y en el
 * centro de conciliación.
 */
import { useTenant } from "@/core/tenant-context";
import { canManageTeam } from "@/core/tenant-selection";
import { useImportGuides } from "../bank/api";
import ImportGuide from "../bank/ImportGuide";
import { financingOrdersGuide, financingPaymentsGuide } from "../bank/sources";
import { useFinancingProvider } from "./api";
import FinancingImportCard from "./FinancingImportCard";
import FinancingPaymentsCard from "./FinancingPaymentsCard";

export default function FinancingFilesPanel() {
  const { active } = useTenant();
  const canEdit = canManageTeam(active?.role);
  const provider = useFinancingProvider();
  const { data: guides = [] } = useImportGuides();
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Para una conciliación completa, descarga los dos archivos de {provider} con el mismo rango de fechas: primero las órdenes y cuotas, después los pagos recibidos.
      </p>
      <ImportGuide guideKey="financing:orders" guides={guides} defaultSteps={financingOrdersGuide(provider)} canEdit={canEdit} title="1 · ¿Dónde obtengo el reporte de órdenes?" />
      <FinancingImportCard />
      <ImportGuide guideKey="financing:payments" guides={guides} defaultSteps={financingPaymentsGuide(provider)} canEdit={canEdit} title="2 · ¿Dónde obtengo el archivo de pagos?" />
      <FinancingPaymentsCard />
    </div>
  );
}
