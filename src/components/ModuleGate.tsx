import type { ReactNode } from "react";
import AppShell from "@/components/AppShell";
import { MODULE_LABELS, type ModuleKey } from "@/core/entitlements";
import { useEntitlements } from "@/core/useEntitlements";

/** Pantalla de un módulo: si el plan no lo incluye, lo dice en vez de fallar al guardar. */
export default function ModuleGate({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const entitlements = useEntitlements();
  if (entitlements[module]) return <>{children}</>;
  return (
    <AppShell>
      <div className="space-y-2 rounded-surface border bg-card p-6">
        <h1 className="text-xl">{MODULE_LABELS[module]}</h1>
        <p className="text-sm text-muted-foreground">Este módulo no está incluido en el plan del negocio. Escríbenos para activarlo.</p>
      </div>
    </AppShell>
  );
}
