import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";
import type { ImportPayloadRow } from "./preview";
import type { RubroAttribute } from "./rubros";
import type { TemplateV2 } from "./templates";

export interface AttributeDef {
  id: string;
  key: string;
  label: string;
  type: "text" | "number" | "list";
  choices: string[] | null;
  searchable: boolean;
  multi: boolean;
  position: number;
}

export interface ImportTemplate {
  id: string;
  name: string;
  /** Formato v1 (cruce plano) o v2; se lee con readTemplate. */
  mapping: unknown;
  updated_at: string;
}

export interface ImportJob {
  id: string;
  file_name: string;
  total_rows: number;
  result: Record<string, number>;
  created_at: string;
}

export interface ImportResult {
  job_id: string;
  already_applied: boolean;
  products_created: number;
  products_updated: number;
  variants_created: number;
  variants_updated: number;
  stock_rows_applied: number;
}

function useTenantKey() {
  const { active } = useTenant();
  return active?.tenant.id ?? "none";
}

function asError(error: { message?: string } | null): Error {
  return new Error(error?.message ?? "Error desconocido");
}

export { attributeKey } from "./fields";

export function useAttributeDefs() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["inv", tenant, "attribute_defs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("attribute_defs").select("*").order("position").order("label");
      if (error) throw error;
      return (data ?? []) as AttributeDef[];
    },
  });
}

export function useSaveAttributeDef() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<AttributeDef, "id" | "position" | "choices"> & { id?: string }) => {
      const { id, ...fields } = input;
      const { error } = id
        ? await supabase.from("attribute_defs").update({ label: fields.label, type: fields.type, searchable: fields.searchable, multi: fields.multi }).eq("id", id)
        : await supabase.from("attribute_defs").insert(fields);
      if (error) throw asError(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inv"] }),
  });
}

/** Crea los campos de la plantilla de rubro que aún no existan. */
export function useApplyRubro() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ attributes, existingKeys }: { attributes: RubroAttribute[]; existingKeys: string[] }) => {
      const missing = attributes.filter((a) => !existingKeys.includes(a.key));
      if (missing.length === 0) return 0;
      const { error } = await supabase.from("attribute_defs").insert(missing.map((a, i) => ({ ...a, position: i })));
      if (error) throw asError(error);
      return missing.length;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inv"] }),
  });
}

export function useImportTemplates() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["inv", tenant, "import_templates"],
    queryFn: async () => {
      const { data, error } = await supabase.from("import_templates").select("id, name, mapping, updated_at").order("name");
      if (error) throw error;
      return (data ?? []) as ImportTemplate[];
    },
  });
}

export function useSaveImportTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, template }: { name: string; template: TemplateV2 }) => {
      const clean = template;
      const { data: existing } = await supabase.from("import_templates").select("id").eq("name", name.trim()).maybeSingle();
      const { error } = existing
        ? await supabase.from("import_templates").update({ mapping: clean }).eq("id", existing.id)
        : await supabase.from("import_templates").insert({ name: name.trim(), mapping: clean });
      if (error) throw asError(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inv"] }),
  });
}

/** Crea los campos propios que el cruce usa y aún no existen (texto, buscables). */
export async function ensureAttributes(wanted: { key: string; label: string }[], existingKeys: string[]) {
  const seen = new Set(existingKeys);
  const missing = wanted.filter((a) => !seen.has(a.key) && seen.add(a.key));
  if (missing.length === 0) return 0;
  const { error } = await supabase
    .from("attribute_defs")
    .insert(missing.map((a) => ({ key: a.key, label: a.label, type: "text", multi: false, searchable: true })));
  if (error) throw asError(error);
  return missing.length;
}

export function useImportJobs() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["inv", tenant, "import_jobs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("import_jobs")
        .select("id, file_name, total_rows, result, created_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as ImportJob[];
    },
  });
}

export function useApplyImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ fileName, fileHash, rows }: { fileName: string; fileHash: string; rows: ImportPayloadRow[] }) => {
      const { data, error } = await supabase.rpc("catalog_import", { p_file_name: fileName, p_file_hash: fileHash, p_rows: rows });
      if (error) throw asError(error);
      return data as ImportResult;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inv"] }),
  });
}
