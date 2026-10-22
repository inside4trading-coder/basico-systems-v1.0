import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ROLE_LABELS } from "@/components/AppShell";
import { Switch } from "@/components/ui/switch";
import {
  AREA_LABELS,
  CAPABILITIES,
  CAPABILITY_KEYS,
  EDITABLE_ROLES,
  roleAllows,
  type Capability,
  type CapabilityArea,
  type EditableRole,
} from "@/core/capabilities";
import { supabase } from "@/core/supabase";
import { useTenant } from "@/core/tenant-context";

const AREAS = Object.keys(AREA_LABELS) as CapabilityArea[];

/**
 * Matriz rol × permiso. El dueño la edita; el resto la ve. El dueño siempre
 * puede todo, por eso no tiene columna. La base aplica cada cambio.
 */
export default function PermissionsMatrix() {
  const { active, capabilityOverrides } = useTenant();
  const queryClient = useQueryClient();
  const editable = active?.role === "owner";

  const save = useMutation({
    mutationFn: async ({ role, capability, allowed }: { role: EditableRole; capability: Capability; allowed: boolean }) => {
      const { error } = await supabase.rpc("set_role_capability", { p_role: role, p_capability: capability, p_allowed: allowed });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["capabilities", active?.tenant.id] }),
    onError: (err: Error) => toast.error(err.message),
  });

  const isCustom = (role: EditableRole, capability: Capability) =>
    capabilityOverrides.some((o) => o.role === role && o.capability === capability);

  return (
    <section className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {editable
          ? "Marca lo que puede hacer cada rol. El dueño siempre puede todo. Los cambios aplican al momento para todo el equipo."
          : "Lo que puede hacer cada rol en este negocio. Solo el dueño cambia estos permisos."}
      </p>
      <div className="overflow-x-auto rounded-surface border bg-card">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b text-left">
              <th scope="col" className="px-4 py-2 font-medium">
                Permiso
              </th>
              {EDITABLE_ROLES.map((role) => (
                <th key={role} scope="col" className="w-28 px-2 py-2 text-center font-medium">
                  {ROLE_LABELS[role]}
                </th>
              ))}
            </tr>
          </thead>
          {AREAS.map((area) => (
            <tbody key={area}>
              <tr className="bg-muted/40">
                <th colSpan={EDITABLE_ROLES.length + 1} scope="colgroup" className="mono-cap px-4 py-1.5 text-left text-[10px] text-muted-foreground">
                  {AREA_LABELS[area]}
                </th>
              </tr>
              {CAPABILITY_KEYS.filter((key) => CAPABILITIES[key].area === area).map((key) => (
                <tr key={key} className="border-t">
                  <th scope="row" className="px-4 py-2 text-left font-normal">
                    {CAPABILITIES[key].label}
                  </th>
                  {EDITABLE_ROLES.map((role) => {
                    const allowed = roleAllows(role, key, capabilityOverrides);
                    return (
                      <td key={role} className="px-2 py-2 text-center">
                        <span className="inline-flex items-center gap-1">
                          <Switch
                            checked={allowed}
                            disabled={!editable || save.isPending}
                            aria-label={`${CAPABILITIES[key].label}: ${ROLE_LABELS[role]}`}
                            onCheckedChange={(next) => save.mutate({ role, capability: key, allowed: next })}
                          />
                          {isCustom(role, key) && (
                            <span className="h-1.5 w-1.5 rounded-full bg-primary" title="Cambiado respecto al valor inicial" aria-hidden />
                          )}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle" aria-hidden />
        Cambiado respecto al valor inicial.
      </p>
    </section>
  );
}
