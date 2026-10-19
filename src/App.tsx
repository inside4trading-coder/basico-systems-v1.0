import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/core/auth";
import { TenantProvider, useTenant } from "@/core/tenant-context";
import Login from "@/pages/Login";
import SelectTenant from "@/pages/SelectTenant";
import NoAccess from "@/pages/NoAccess";
import Home from "@/pages/Home";
import Team from "@/pages/Team";
import InventoryPage from "@/modules/inventory/InventoryPage";
import ControlPage from "@/modules/inventory/ControlPage";
import LocationsPage from "@/modules/inventory/LocationsPage";
import ImportPage from "@/modules/inventory/ImportPage";
import CatalogFieldsPage from "@/modules/inventory/CatalogFieldsPage";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function Loading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background">
      <p className="mono-cap text-xs text-muted-foreground">Cargando…</p>
    </main>
  );
}

/** Sesión, luego tenant elegido, luego tenant activo. Cada paso tiene su pantalla. */
function RequireTenant({ children }: { children: ReactNode }) {
  const { session, loading: authLoading } = useAuth();
  const { memberships, active, loading, error } = useTenant();

  if (authLoading) return <Loading />;
  if (!session) return <Navigate to="/login" replace />;
  if (loading) return <Loading />;
  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-4">
        <p className="text-sm text-destructive">No se pudo cargar tu cuenta. Recarga la página.</p>
      </main>
    );
  }
  if (memberships.length === 0) return <NoAccess reason="no-tenant" />;
  if (!active) return <SelectTenant />;
  if (active.tenant.status === "suspended") return <NoAccess reason="suspended" />;
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TenantProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route
                path="/equipo"
                element={
                  <RequireTenant>
                    <Team />
                  </RequireTenant>
                }
              />
              <Route
                path="/inventario"
                element={
                  <RequireTenant>
                    <InventoryPage />
                  </RequireTenant>
                }
              />
              <Route
                path="/control"
                element={
                  <RequireTenant>
                    <ControlPage />
                  </RequireTenant>
                }
              />
              <Route
                path="/inventario/importar"
                element={
                  <RequireTenant>
                    <ImportPage />
                  </RequireTenant>
                }
              />
              <Route
                path="/catalogo/campos"
                element={
                  <RequireTenant>
                    <CatalogFieldsPage />
                  </RequireTenant>
                }
              />
              <Route
                path="/sedes"
                element={
                  <RequireTenant>
                    <LocationsPage />
                  </RequireTenant>
                }
              />
              <Route
                path="*"
                element={
                  <RequireTenant>
                    <Home />
                  </RequireTenant>
                }
              />
            </Routes>
          </BrowserRouter>
          <Toaster />
        </TenantProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
