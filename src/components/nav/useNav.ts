import { useMemo, useState } from "react";
import { useTenant } from "@/core/tenant-context";
import { useEntitlements } from "@/core/useEntitlements";
import { visibleModules, type NavModule } from "./navModules";

const COLLAPSED_KEY = "bsys.sidebar.collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Módulos visibles para el usuario y el plan del negocio activo. */
export function useNavModules(): NavModule[] {
  const { can } = useTenant();
  const entitlements = useEntitlements();
  return useMemo(() => visibleModules(can, entitlements), [can, entitlements]);
}

/** Estado del panel de submódulos (plegado o no), recordado en el navegador. */
export function useSidebarCollapsed(): [boolean, (v: boolean) => void] {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const set = (v: boolean) => {
    setCollapsed(v);
    try {
      localStorage.setItem(COLLAPSED_KEY, v ? "1" : "0");
    } catch {
      // Sin almacenamiento: solo dura en esta pestaña.
    }
  };
  return [collapsed, set];
}

