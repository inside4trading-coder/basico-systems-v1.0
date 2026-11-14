/** [B]eto: conversaciones, mensajes, uso del mes y enviar una pregunta. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";
import { useEntitlements } from "@/core/useEntitlements";
import type { PromptAccess } from "./prompts";

export interface BetoKpi {
  type: "kpi";
  label: string;
  value: string;
  hint?: string;
}

export interface BetoMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  blocks: BetoKpi[] | null;
  status: "pendiente" | "listo" | "fallido";
  error: string | null;
  created_at: string;
}

export interface BetoConversation {
  id: string;
  title: string;
  updated_at: string;
}

export interface BetoUsage {
  enabled: boolean;
  used: number;
  limit: number;
}

export interface BetoAnswer {
  conversation_id: string;
  message_id: string;
  text: string;
  blocks: BetoKpi[];
}

const asError = (error: { message?: string }) => new Error(error.message ?? "Error inesperado");

/** ¿Este usuario ve a [B]eto? (add-on del plan + permiso del rol). La base lo hace cumplir. */
export function useBetoAccess(): boolean {
  const { can } = useTenant();
  const entitlements = useEntitlements();
  return entitlements.beto && can("beto.usar");
}

/** Qué áreas puede consultar (para no sugerir preguntas que [B]eto no le puede responder). */
export function useBetoPromptAccess(): PromptAccess {
  const { can } = useTenant();
  const entitlements = useEntitlements();
  return { reportes: can("reportes.ver") && entitlements.reportes, finanzas: can("finanzas.operar") };
}

export function useBetoConversations(enabled = true) {
  const { active } = useTenant();
  return useQuery({
    queryKey: ["beto", active?.tenant.id, "conversations"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("beto_conversations")
        .select("id, title, updated_at")
        .order("updated_at", { ascending: false })
        .limit(50);
      if (error) throw asError(error);
      return (data ?? []) as BetoConversation[];
    },
  });
}

export function useBetoMessages(conversationId: string | null) {
  const { active } = useTenant();
  return useQuery({
    queryKey: ["beto", active?.tenant.id, "messages", conversationId],
    enabled: !!conversationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("beto_messages")
        .select("id, conversation_id, role, content, blocks, status, error, created_at")
        .eq("conversation_id", conversationId!)
        .order("created_at")
        .limit(200);
      if (error) throw asError(error);
      return (data ?? []) as BetoMessage[];
    },
  });
}

export function useBetoUsage(enabled = true) {
  const { active } = useTenant();
  return useQuery({
    queryKey: ["beto", active?.tenant.id, "usage"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("beto_usage");
      if (error) throw asError(error);
      return data as BetoUsage | null;
    },
  });
}

export function useSendBeto() {
  const qc = useQueryClient();
  const { active } = useTenant();
  return useMutation({
    mutationFn: async (input: { conversationId: string | null; message: string; page?: string }) => {
      const { data, error } = await supabase.functions.invoke("beto", {
        body: { conversation_id: input.conversationId, message: input.message, page: input.page },
      });
      if (error) throw asError(error);
      if (data?.error) throw Object.assign(new Error(data.error as string), { conversationId: (data.conversation_id as string) ?? null });
      return data as BetoAnswer;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["beto", active?.tenant.id] }),
  });
}

export function useDeleteBetoConversation() {
  const qc = useQueryClient();
  const { active } = useTenant();
  return useMutation({
    mutationFn: async (conversationId: string) => {
      const { error } = await supabase.rpc("beto_delete_conversation", { p_conversation_id: conversationId });
      if (error) throw asError(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["beto", active?.tenant.id, "conversations"] }),
  });
}
