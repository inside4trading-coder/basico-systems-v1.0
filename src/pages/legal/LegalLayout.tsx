import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import BrandMark from "@/components/BrandMark";

/** Fecha de la versión vigente de los textos legales. */
export const LEGAL_UPDATED = "23 de octubre de 2026";

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

/** Página pública de texto legal (términos, privacidad). */
export default function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b bg-card px-4 py-3">
        <Link to="/" aria-label="Inicio">
          <BrandMark className="text-xl" />
        </Link>
        <nav className="flex gap-4 text-sm">
          <Link to="/terminos" className="text-muted-foreground hover:text-foreground">
            Términos
          </Link>
          <Link to="/privacidad" className="text-muted-foreground hover:text-foreground">
            Privacidad
          </Link>
        </nav>
      </header>
      <main className="mx-auto max-w-2xl space-y-6 px-4 py-8">
        <div className="space-y-1">
          <h1 className="text-2xl">{title}</h1>
          <p className="text-xs text-muted-foreground">Última actualización: {LEGAL_UPDATED}</p>
        </div>
        {children}
      </main>
    </div>
  );
}
