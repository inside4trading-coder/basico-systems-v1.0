import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

const CLASS = "inline-flex items-center gap-1 text-sm text-primary hover:underline";

/**
 * Volver a la pantalla de origen: "← destino". Con `to` navega; con `onClick`
 * vuelve dentro de la misma pantalla (una hoja o un detalle).
 */
export default function BackLink({ to, onClick, children, className }: { to?: string; onClick?: () => void; children: ReactNode; className?: string }) {
  const content = (
    <>
      <span aria-hidden>←</span> {children}
    </>
  );
  if (to) {
    return (
      <Link to={to} className={cn(CLASS, className)}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cn(CLASS, className)}>
      {content}
    </button>
  );
}
