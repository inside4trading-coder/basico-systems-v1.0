/** Etiquetas: imprimir y plantillas. */
import AppShell from "@/components/AppShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTabParam } from "@/lib/useTabParam";
import PrintPanel from "./PrintPanel";
import TemplatesPanel from "./TemplatesPanel";
import UnitsPanel from "./UnitsPanel";
import SearchPanel from "./SearchPanel";
import HistoryPanel from "./HistoryPanel";

const TABS = ["imprimir", "unidades", "buscar", "historial", "plantillas"] as const;
type Tab = (typeof TABS)[number];

export default function LabelsPage() {
  const [tab, setTab] = useTabParam<Tab>(TABS, "imprimir");
  return (
    <AppShell wide>
      <div>
        <h1 className="text-2xl">Etiquetas</h1>
        <p className="text-sm text-muted-foreground">Etiquetas de precio y código para cualquier producto, en rollo o en hoja.</p>
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="space-y-4">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="imprimir">Imprimir</TabsTrigger>
          <TabsTrigger value="unidades">Por unidad</TabsTrigger>
          <TabsTrigger value="buscar">Buscar</TabsTrigger>
          <TabsTrigger value="historial">Historial</TabsTrigger>
          <TabsTrigger value="plantillas">Plantillas</TabsTrigger>
        </TabsList>
        <TabsContent value="imprimir">
          <PrintPanel />
        </TabsContent>
        <TabsContent value="unidades">
          <UnitsPanel />
        </TabsContent>
        <TabsContent value="buscar">
          <SearchPanel />
        </TabsContent>
        <TabsContent value="historial">
          <HistoryPanel />
        </TabsContent>
        <TabsContent value="plantillas">
          <TemplatesPanel />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
