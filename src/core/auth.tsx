import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { clearCaches, isNetworkError } from "./offline";
import { supabase } from "./supabase";

function storedSession(): Session | null {
  try {
    const key = Object.keys(localStorage).find((k) => /^sb-.+-auth-token$/.test(k));
    const raw = key ? localStorage.getItem(key) : null;
    const parsed = raw ? (JSON.parse(raw) as Session) : null;
    return parsed?.user ? parsed : null;
  } catch {
    return null;
  }
}

interface AuthState {
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data, error }) => {
      // Sin red y con el token vencido, getSession no puede refrescarlo y
      // devuelve null aunque la sesión siga guardada. Para no echar al cajero
      // en un apagón se usa la guardada; al volver la red el cliente la
      // refresca solo (o, si ya no vale, avisa con SIGNED_OUT).
      setSession(data.session ?? (error && isNetworkError(error) ? storedSession() : null));
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    clearCaches();
    await supabase.auth.signOut();
  };

  return <AuthContext.Provider value={{ session, loading, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return ctx;
}
