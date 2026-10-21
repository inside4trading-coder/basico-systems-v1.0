/**
 * Conciliación: importar archivos de cada fuente, conciliar por cuenta, lo
 * que falta por identificar y el historial de cargas.
 * Portado de SublimeAdminReconciliationShell (basicosystems@9cb08cd).
 */
import { useState } from "react";
import { cn } from "@/lib/utils";
import { ALL_ACCOUNTS, useBankLines } from "./api";
import HistoryPanel from "./HistoryPanel";
import ImportCenter from "./ImportCenter";
import ReconciliationTab from "./ReconciliationTab";
import UnidentifiedPanel from "./UnidentifiedPanel";

type Section = "import" | "reconcile" | "unidentified" | "history";
const SECTIONS: { id: Section; label: string }[] = [
  { id: "import", label: "Importar archivos" },
  { id: "reconcile", label: "Conciliar" },
  { id: "unidentified", label: "Por identificar" },
  { id: "history", label: "Historial" },
];

export default function ReconciliationCenter() {
  const [section, setSection] = useState<Section>("import");
  const { data: lines = [] } = useBankLines(ALL_ACCOUNTS);
  const pending = lines.filter((l) => l.status === "unmatched" || l.status === "possible").length;

  return (
    <div className="space-y-4">
      <nav aria-label="Secciones de conciliación" className="-mx-1 overflow-x-auto px-1">
        <div className="inline-flex gap-1 rounded-lg bg-muted p-1">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={section === s.id}
              onClick={() => setSection(s.id)}
              className={cn(
                "whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors",
                section === s.id ? "bg-background font-semibold shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s.label}
              {s.id === "unidentified" && pending > 0 && <span className="num ml-1 text-xs text-destructive">({pending})</span>}
            </button>
          ))}
        </div>
      </nav>
      {section === "import" && <ImportCenter />}
      {section === "reconcile" && <ReconciliationTab />}
      {section === "unidentified" && <UnidentifiedPanel />}
      {section === "history" && <HistoryPanel />}
    </div>
  );
}
