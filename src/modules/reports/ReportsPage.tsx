/**
 * Reportes: ventas por periodo, sede, producto, método y cajero; stock
 * valorizado y sin rotación; cierres de caja. Portado de SublimeDashboard.tsx,
 * SublimeCierres.tsx y SublimeFinanciero.tsx (basicosystems@f551478b), con los
 * números calculados en la base.
 */
import { useState } from "react";
import { Navigate } from "react-router-dom";
import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTenant } from "@/core/tenant-context";
import { canSeeReports } from "@/core/tenant-selection";
import { useLocations } from "@/modules/inventory/api";
import ClosuresReport from "./ClosuresReport";
import { PRESET_LABEL, presetRange, type DateRange, type RangePreset } from "./dates";
import SalesReportView from "./SalesReport";
import StockReport from "./StockReport";

const ALL = "all";

export default function ReportsPage() {
  const { active } = useTenant();
  const { data: locations = [] } = useLocations();
  const [preset, setPreset] = useState<RangePreset | null>("7d");
  const [range, setRange] = useState<DateRange>(() => presetRange("7d"));
  const [location, setLocation] = useState(ALL);

  if (!canSeeReports(active?.role)) return <Navigate to="/" replace />;
  const locationId = location === ALL ? null : location;
  const base = active?.tenant.base_currency ?? "USD";

  const choose = (p: RangePreset) => {
    setPreset(p);
    setRange(presetRange(p));
  };
  const setDay = (key: keyof DateRange, value: string) => {
    if (!value) return;
    setPreset(null);
    setRange((r) => {
      const next = { ...r, [key]: value };
      return next.from > next.to ? { from: value, to: value } : next;
    });
  };

  const filters = (withDates: boolean) => (
    <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-card p-3">
      {withDates && (
        <>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Periodo">
            {(Object.keys(PRESET_LABEL) as RangePreset[]).map((p) => (
              <Button key={p} size="sm" variant={preset === p ? "default" : "outline"} onClick={() => choose(p)}>
                {PRESET_LABEL[p]}
              </Button>
            ))}
          </div>
          <Input type="date" aria-label="Desde" value={range.from} onChange={(e) => setDay("from", e.target.value)} className="h-9 w-40" />
          <Input type="date" aria-label="Hasta" value={range.to} onChange={(e) => setDay("to", e.target.value)} className="h-9 w-40" />
        </>
      )}
      <Select value={location} onValueChange={setLocation}>
        <SelectTrigger className="h-9 w-48" aria-label="Sede">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todas las sedes</SelectItem>
          {locations.map((l) => (
            <SelectItem key={l.id} value={l.id}>
              {l.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <AppShell wide>
      <h1 className="text-2xl">Reportes</h1>
      <Tabs defaultValue="sales" className="space-y-4">
        <TabsList>
          <TabsTrigger value="sales">Ventas</TabsTrigger>
          <TabsTrigger value="stock">Inventario</TabsTrigger>
          <TabsTrigger value="closures">Cierres de caja</TabsTrigger>
        </TabsList>
        <TabsContent value="sales" className="space-y-4">
          {filters(true)}
          <SalesReportView range={range} locationId={locationId} currency={base} />
        </TabsContent>
        <TabsContent value="stock" className="space-y-4">
          {filters(false)}
          <StockReport locationId={locationId} currency={base} />
        </TabsContent>
        <TabsContent value="closures" className="space-y-4">
          {filters(true)}
          <ClosuresReport range={range} locationId={locationId} currency={base} businessName={active?.tenant.name ?? ""} />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
