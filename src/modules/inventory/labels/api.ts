import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";
import { useTenantSettings } from "@/modules/settings/api";
import { PRESET_TEMPLATES, type LabelHeader, type LabelTemplate, type LabelTemplateDraft } from "./labels";

const COLUMNS =
  "id, name, media, width_mm, height_mm, page, columns, rows, code_kind, show_header, header_text, show_tax_id, show_name, show_detail, show_sku, show_price, show_price_local, is_default";

function useTenantKey() {
  const { active } = useTenant();
  return active?.tenant.id ?? "none";
}

/** Plantillas del negocio más las de fábrica; la predeterminada primero. */
export function useLabelTemplates() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["label-templates", tenant],
    queryFn: async () => {
      const { data, error } = await supabase.from("label_templates").select(COLUMNS).order("name");
      if (error) throw new Error(error.message);
      const own = (data ?? []).map((t) => ({ ...t, width_mm: Number(t.width_mm), height_mm: Number(t.height_mm) })) as LabelTemplate[];
      return { own, all: [...own, ...PRESET_TEMPLATES] };
    },
  });
}

/** La plantilla con la que abre la impresión: la predeterminada del negocio o el rollo de fábrica. */
export function defaultTemplate(all: LabelTemplate[]): LabelTemplate {
  return all.find((t) => t.is_default) ?? all.find((t) => t.id === PRESET_TEMPLATES[0].id) ?? PRESET_TEMPLATES[0];
}

export function useSaveLabelTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, draft }: { id: string | null; draft: LabelTemplateDraft }) => {
      const row = { ...draft, name: draft.name.trim(), header_text: draft.header_text?.trim() || null };
      const res = id
        ? await supabase.from("label_templates").update(row).eq("id", id).select("id").single()
        : await supabase.from("label_templates").insert(row).select("id").single();
      if (res.error) throw new Error(res.error.message);
      return res.data.id as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["label-templates"] }),
  });
}

export function useDeleteLabelTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("label_templates").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["label-templates"] }),
  });
}

/** Encabezado de la etiqueta: el texto de la plantilla o el nombre del negocio, y su RIF. */
export function useLabelHeader(template: Pick<LabelTemplate, "header_text"> | null): LabelHeader {
  const { data: settings } = useTenantSettings();
  return {
    text: template?.header_text?.trim() || settings?.legal_name || settings?.name || "",
    taxId: settings?.tax_id ?? null,
  };
}
