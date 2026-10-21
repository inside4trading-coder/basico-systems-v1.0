/** Fichaje: datos para encargados y para la pantalla pública del teléfono. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";
import { addDays, type DateRange } from "@/modules/reports/dates";
import type { ClockEvent, ClockKind } from "./lib";

export interface StaffClock {
  id: string;
  name: string;
  job_title: string | null;
  location_id: string | null;
  is_active: boolean;
  clock_enabled: boolean;
  pin_set_at: string | null;
  work_days: number[];
  entry_time: string | null;
  exit_time: string | null;
  break_minutes: number;
  late_tolerance: number;
}

function asError(error: { message?: string } | null): Error {
  return new Error(error?.message ?? "Error desconocido");
}

/** Comienzo de un día de Caracas (UTC−4, sin horario de verano). */
const caracasDayStart = (day: string) => new Date(`${day}T00:00:00-04:00`).toISOString();

function useTenantKey() {
  const { active } = useTenant();
  return active?.tenant.id ?? "none";
}

export function useStaffClock() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["clock", tenant, "staff"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cashiers")
        .select("id, name, job_title, location_id, is_active, clock_enabled, pin_set_at, work_days, entry_time, exit_time, break_minutes, late_tolerance")
        .order("name");
      if (error) throw asError(error);
      return (data ?? []) as StaffClock[];
    },
  });
}

export function useClockEvents(range: DateRange) {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["clock", tenant, "events", range.from, range.to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clock_events")
        .select("id, staff_id, location_id, kind, event_at, source, distance_m, accuracy_m, late_minutes, status, note")
        .gte("event_at", caracasDayStart(range.from))
        .lt("event_at", caracasDayStart(addDays(range.to, 1)))
        .order("event_at", { ascending: false })
        .limit(5000);
      if (error) throw asError(error);
      return (data ?? []).map((e) => ({
        ...e,
        distance_m: e.distance_m === null ? null : Number(e.distance_m),
        accuracy_m: e.accuracy_m === null ? null : Number(e.accuracy_m),
      })) as ClockEvent[];
    },
    refetchInterval: 60_000,
  });
}

export function useClockKey() {
  const tenant = useTenantKey();
  return useQuery({
    queryKey: ["clock", tenant, "key"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clock_key");
      if (error) throw asError(error);
      return data as string | null;
    },
  });
}

function useInvalidateClock() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["clock"] });
}

export function useClockActions() {
  const invalidate = useInvalidateClock();
  const qc = useQueryClient();
  const onSuccess = () => {
    invalidate();
    qc.invalidateQueries({ queryKey: ["cfg"] });
  };
  return {
    setPin: useMutation({
      mutationFn: async ({ staffId, pin }: { staffId: string; pin: string | null }) => {
        const { error } = await supabase.rpc("set_staff_pin", { p_staff_id: staffId, p_pin: pin });
        if (error) throw asError(error);
      },
      onSuccess,
    }),
    saveSchedule: useMutation({
      mutationFn: async ({ id, ...patch }: Partial<StaffClock> & { id: string }) => {
        const { error } = await supabase.from("cashiers").update(patch).eq("id", id);
        if (error) throw asError(error);
      },
      onSuccess,
    }),
    addEvent: useMutation({
      mutationFn: async (input: { staffId: string; kind: ClockKind; at: string; note: string }) => {
        const { error } = await supabase.rpc("add_clock_event", { p_staff_id: input.staffId, p_kind: input.kind, p_at: input.at, p_note: input.note });
        if (error) throw asError(error);
      },
      onSuccess,
    }),
    review: useMutation({
      mutationFn: async ({ eventId, status }: { eventId: string; status: "aprobado" | "rechazado" }) => {
        const { error } = await supabase.rpc("review_clock_event", { p_event_id: eventId, p_status: status });
        if (error) throw asError(error);
      },
      onSuccess,
    }),
    regenerateKey: useMutation({
      mutationFn: async () => {
        const { data, error } = await supabase.rpc("regenerate_clock_key");
        if (error) throw asError(error);
        return data as string;
      },
      onSuccess,
    }),
  };
}

// ---------------------------------------------------------------------------
// Pantalla pública (sin sesión)
// ---------------------------------------------------------------------------

export interface ClockToday {
  events: { kind: ClockKind; at: string; status: string }[];
  allowed: ClockKind[];
}

export interface ClockLookup {
  ok: boolean;
  error?: string;
  name?: string;
  business?: string;
  location?: string | null;
  needs_location?: boolean;
  today?: ClockToday;
}

export interface ClockPunch {
  ok: boolean;
  error?: string;
  duplicate?: boolean;
  kind?: ClockKind;
  status?: string;
  late_minutes?: number | null;
  location?: string | null;
  today?: ClockToday;
}

export async function clockLookup(key: string, pin: string): Promise<ClockLookup> {
  const { data, error } = await supabase.rpc("clock_lookup", { p_key: key, p_pin: pin });
  if (error) throw asError(error);
  return data as ClockLookup;
}

export async function clockPunch(
  key: string,
  pin: string,
  kind: ClockKind,
  position: { latitude: number; longitude: number; accuracy: number } | null,
): Promise<ClockPunch> {
  const { data, error } = await supabase.rpc("clock_punch", {
    p_key: key,
    p_pin: pin,
    p_kind: kind,
    p_latitude: position?.latitude ?? null,
    p_longitude: position?.longitude ?? null,
    p_accuracy: position ? Math.round(position.accuracy) : null,
  });
  if (error) throw asError(error);
  return data as ClockPunch;
}
