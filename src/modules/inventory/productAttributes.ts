/**
 * Valores de los campos propios de un producto (lo que llegó en columnas
 * extra al importar: código original, ubicación, proveedor…).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";

export interface AttributeValue {
  attribute_id: string;
  value: string;
}

export function useProductAttributes(productId: string | null) {
  const { active } = useTenant();
  return useQuery({
    queryKey: ["inv", active?.tenant.id ?? "none", "product_attributes", productId],
    enabled: Boolean(productId),
    queryFn: async () => {
      const { data, error } = await supabase.from("product_attribute_values").select("attribute_id, value").eq("product_id", productId!).order("value");
      if (error) throw error;
      return (data ?? []) as AttributeValue[];
    },
  });
}

/** Separa «Hilux 2010; Fortuner 2012» en valores para un campo de varios valores. */
export function splitValues(text: string, multi: boolean): string[] {
  const values = multi ? text.split(/[;|]/) : [text];
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

/** Reemplaza los valores de un campo propio del producto. */
export function useSaveProductAttribute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ productId, attributeId, values }: { productId: string; attributeId: string; values: string[] }) => {
      const { error: delError } = await supabase.from("product_attribute_values").delete().eq("product_id", productId).eq("attribute_id", attributeId);
      if (delError) throw new Error(delError.message);
      if (values.length === 0) return;
      const { error } = await supabase
        .from("product_attribute_values")
        .insert(values.map((value) => ({ product_id: productId, attribute_id: attributeId, value })));
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inv"] }),
  });
}
