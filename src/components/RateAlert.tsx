import { AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { useTenant } from "@/core/tenant-context";
import { formatRate, formatRateDate } from "@/core/money";
import { useCurrentRate, useTenantSettings } from "@/modules/settings/api";

/**
 * Aviso para quien configura el negocio cuando la tasa oficial no está al día
 * (o no hay): lleva a Configuración → Tasa de cambio. Con tasa propia o de
 * emergencia no aparece: esa tasa la decide el negocio.
 */
export default function RateAlert() {
  const { can } = useTenant();
  const { data: settings } = useTenantSettings();
  const { data: rate, isSuccess } = useCurrentRate();
  if (!can("config.negocio") || !settings?.local_currency || settings.rate_source !== "bcv" || !isSuccess) return null;
  if (rate && (rate.source === "manual" || !rate.stale)) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
      <span className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {rate
          ? `La tasa no está al día: se cobra con ${formatRate(rate.rate)}, que rige desde el ${formatRateDate(rate.effective_date)}.`
          : "No hay tasa de cambio: el POS no puede convertir a bolívares."}
      </span>
      <Link to="/configuracion#tasa" className="font-semibold underline underline-offset-4">
        Revisar la tasa
      </Link>
    </div>
  );
}
