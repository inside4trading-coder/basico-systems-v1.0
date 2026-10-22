import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/core/auth";
import { TenantProvider, useTenant } from "@/core/tenant-context";
import Login from "@/pages/Login";
import ResetPassword from "@/pages/ResetPassword";
import Signup from "@/pages/Signup";
import Platform from "@/pages/Platform";
import OnboardingPage from "@/modules/onboarding/OnboardingPage";
import NewPasswordForm from "@/components/NewPasswordForm";
import SelectTenant from "@/pages/SelectTenant";
import NoAccess from "@/pages/NoAccess";
import Home from "@/pages/Home";
import Team from "@/pages/Team";
import InventoryPage from "@/modules/inventory/InventoryPage";
import ControlPage from "@/modules/inventory/ControlPage";
import LocationsPage from "@/modules/inventory/LocationsPage";
import ImportPage from "@/modules/inventory/ImportPage";
import CatalogFieldsPage from "@/modules/inventory/CatalogFieldsPage";
import SettingsPage from "@/modules/settings/SettingsPage";
import PosPage from "@/modules/pos/PosPage";
import ReportsPage from "@/modules/reports/ReportsPage";
import FinancePage from "@/modules/finance/FinancePage";
import FinancingPage from "@/modules/financing/FinancingPage";
import ObligationDetailPage from "@/modules/finance/obligations/ObligationDetailPage";
import ModuleGate from "@/components/ModuleGate";
import CustomersPage from "@/modules/customers/CustomersPage";
import ClockPage from "@/modules/clock/ClockPage";
import PunchPage from "@/modules/clock/PunchPage";
import StudioPage from "@/modules/studio/StudioPage";

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
  // Equipo invitado por correo: entra sin contraseña y la crea antes de usar la app.
  if (session.user.user_metadata?.needs_password) {
    return (
      <NewPasswordForm
        title="Crea tu contraseña"
        description={`La usarás para entrar como ${session.user.email}`}
        data={{ needs_password: false }}
        onDone={() => undefined}
      />
    );
  }
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
              <Route path="/restablecer" element={<ResetPassword />} />
              {/* Alta de un negocio con el enlace de la plataforma. */}
              <Route path="/alta/:code" element={<Signup />} />
              <Route path="/plataforma" element={<Platform />} />
              {/* Fichar desde el teléfono: sin sesión, con la clave del negocio y el PIN. */}
              <Route path="/fichar/:clockKey" element={<PunchPage />} />
              <Route
                path="/estudio"
                element={
                  <RequireTenant>
                    <ModuleGate module="estudio">
                      <StudioPage />
                    </ModuleGate>
                  </RequireTenant>
                }
              />
              <Route
                path="/fichaje"
                element={
                  <RequireTenant>
                    <ModuleGate module="fichaje">
                      <ClockPage />
                    </ModuleGate>
                  </RequireTenant>
                }
              />
              <Route
                path="/bienvenida"
                element={
                  <RequireTenant>
                    <OnboardingPage />
                  </RequireTenant>
                }
              />
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
                    <ModuleGate module="inventario">
                      <InventoryPage />
                    </ModuleGate>
                  </RequireTenant>
                }
              />
              <Route
                path="/control"
                element={
                  <RequireTenant>
                    <ModuleGate module="inventario">
                      <ControlPage />
                    </ModuleGate>
                  </RequireTenant>
                }
              />
              <Route
                path="/inventario/importar"
                element={
                  <RequireTenant>
                    <ModuleGate module="inventario">
                      <ImportPage />
                    </ModuleGate>
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
                path="/pos"
                element={
                  <RequireTenant>
                    <ModuleGate module="pos">
                      <PosPage />
                    </ModuleGate>
                  </RequireTenant>
                }
              />
              <Route
                path="/clientes"
                element={
                  <RequireTenant>
                    <ModuleGate module="pos">
                      <CustomersPage />
                    </ModuleGate>
                  </RequireTenant>
                }
              />
              <Route
                path="/reportes"
                element={
                  <RequireTenant>
                    <ModuleGate module="reportes">
                      <ReportsPage />
                    </ModuleGate>
                  </RequireTenant>
                }
              />
              <Route
                path="/administracion"
                element={
                  <RequireTenant>
                    <ModuleGate module="administracion">
                      <FinancePage />
                    </ModuleGate>
                  </RequireTenant>
                }
              />
              <Route
                path="/cashea"
                element={
                  <RequireTenant>
                    <ModuleGate module="cashea">
                      <FinancingPage />
                    </ModuleGate>
                  </RequireTenant>
                }
              />
              <Route
                path="/administracion/obligaciones/:id"
                element={
                  <RequireTenant>
                    <ModuleGate module="administracion">
                      <ObligationDetailPage />
                    </ModuleGate>
                  </RequireTenant>
                }
              />
              <Route
                path="/configuracion"
                element={
                  <RequireTenant>
                    <SettingsPage />
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
