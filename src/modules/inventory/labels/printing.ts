/** Imprimir y registrar: cada impresión queda en el historial (label_print_jobs). */
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/core/supabase";
import { printReceipt } from "@/modules/pos/receipt";
import { defaultTemplate, useLabelHeader, useLabelTemplates } from "./api";
import { codeSvg } from "./codes";
import { isPreset, labelsHtml, type LabelItem, type LabelTemplate } from "./labels";
import { usePvp } from "./pricing";
import { fetchVariantInfo, type ItemLabel } from "./unitsApi";

export interface PrintLog {
  kind: "price" | "unit";
  template: LabelTemplate;
  quantity: number;
  labelIds?: string[];
  items?: { variant_id: string; copies: number }[];
  reason?: string | null;
}

export async function logLabelPrint(log: PrintLog): Promise<void> {
  const { error } = await supabase.rpc("log_label_print", {
    p_kind: log.kind,
    p_template_id: isPreset(log.template.id) ? null : log.template.id,
    p_template_name: log.template.name,
    p_quantity: log.quantity,
    p_label_ids: log.labelIds ?? [],
    p_items: log.items ?? [],
    p_reason: log.reason ?? null,
  });
  if (error) throw new Error(error.message);
}

/** Plantilla elegida (por defecto la predeterminada del negocio). */
export function useTemplateChoice() {
  const templates = useLabelTemplates();
  const all = useMemo(() => templates.data?.all ?? [], [templates.data]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const template = all.find((t) => t.id === templateId) ?? (all.length ? defaultTemplate(all) : null);
  return { all, template, setTemplateId };
}

/**
 * Imprime etiquetas por unidad: registra la impresión (marca impresas las
 * nuevas; si todas ya estaban impresas es una reimpresión y pide motivo) y
 * luego abre la hoja.
 */
export function usePrintUnits(template: LabelTemplate | null) {
  const header = useLabelHeader(template);
  const pvp = usePvp();
  const qc = useQueryClient();
  return async (labels: ItemLabel[]): Promise<void> => {
    if (!template) return;
    const active = labels.filter((l) => l.status !== "disabled");
    if (active.length === 0) {
      toast.info("No hay etiquetas activas para imprimir");
      return;
    }
    let reason: string | null = null;
    if (active.every((l) => l.status === "printed")) {
      reason = window.prompt("Ya estaban impresas. ¿Motivo de la reimpresión? (se borró, se despegó, cambio de plantilla…)");
      if (!reason?.trim()) return;
    }
    const info = await fetchVariantInfo([...new Set(active.map((l) => l.variant_id))]);
    const items: LabelItem[] = await Promise.all(
      active.map(async (l) => {
        const v = info.get(l.variant_id);
        return {
          name: v?.name ?? "Producto",
          detail: v?.detail ?? null,
          sku: v?.sku ?? null,
          code: l.code,
          unitCode: l.code,
          ...pvp(v?.net, v?.taxRateId),
          codeSvg: await codeSvg(template.code_kind, l.code),
        };
      }),
    );
    await logLabelPrint({ kind: "unit", template, quantity: active.length, labelIds: active.map((l) => l.id), reason });
    qc.invalidateQueries({ queryKey: ["item-labels"] });
    qc.invalidateQueries({ queryKey: ["label-history"] });
    printReceipt(labelsHtml(items, template, header));
  };
}
