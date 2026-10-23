import { ENTITLEMENT_DEFAULTS, type EntitlementKey } from "@/core/entitlements";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Días que le quedan a la prueba (redondeo hacia arriba), o null si no tiene fin. */
export function trialDaysLeft(trialEndsAt: string | null | undefined, now: Date = new Date()): number | null {
  if (!trialEndsAt) return null;
  return Math.ceil((new Date(trialEndsAt).getTime() - now.getTime()) / DAY_MS);
}

/** El aviso de prueba sale la última semana (y si ya venció). */
export function showTrialNotice(daysLeft: number | null): boolean {
  return daysLeft !== null && daysLeft <= 7;
}

export type PlanForm = Partial<Record<EntitlementKey, boolean | number>>;

/** Solo lo que cambia respecto del plan base: el enlace guarda excepciones. */
export function inviteEntitlements(form: PlanForm): Record<string, boolean | number> {
  const out: Record<string, boolean | number> = {};
  for (const [key, value] of Object.entries(form) as [EntitlementKey, boolean | number | undefined][]) {
    if (value === undefined || value === ENTITLEMENT_DEFAULTS[key]) continue;
    out[key] = value;
  }
  return out;
}

/** Código del enlace a partir de lo que pegue la persona (código solo o URL completa). */
export function parseSignupCode(raw: string): string | null {
  const match = raw.trim().toLowerCase().match(/(?:^|\/alta\/)([0-9a-f]{24})\/?$/);
  return match ? match[1] : null;
}

export type RecipientRole = "owner" | "admin";
export interface InviteRecipient {
  email: string;
  role: RecipientRole;
}

export const MAX_INVITE_RECIPIENTS = 5;
export const RECIPIENT_ROLE_LABEL: Record<RecipientRole, string> = { owner: "Dueño", admin: "Administrador" };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Filas con correo, en minúsculas y sin espacios (las vacías se ignoran). */
export function cleanRecipients(rows: InviteRecipient[]): InviteRecipient[] {
  return rows.map((r) => ({ ...r, email: r.email.trim().toLowerCase() })).filter((r) => r.email !== "");
}

/** Qué impide crear el enlace con esta lista; null si está bien. Sin correos: enlace abierto. */
export function recipientsProblem(rows: InviteRecipient[]): string | null {
  const list = cleanRecipients(rows);
  if (list.length === 0) return null;
  if (list.length > MAX_INVITE_RECIPIENTS) return `Hasta ${MAX_INVITE_RECIPIENTS} correos por enlace`;
  const bad = list.find((r) => !EMAIL_RE.test(r.email));
  if (bad) return `Correo no válido: ${bad.email}`;
  const seen = new Set<string>();
  for (const r of list) {
    if (seen.has(r.email)) return `Correo repetido: ${r.email}`;
    seen.add(r.email);
  }
  if (!list.some((r) => r.role === "owner")) return "Al menos un correo tiene que ser de un dueño";
  return null;
}

export function signupUrl(code: string, origin: string = window.location.origin): string {
  return `${origin}/alta/${code}`;
}

export const WIZARD_STEPS = ["negocio", "productos", "equipo", "listo"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/** Primer paso pendiente del asistente según lo guardado en tenants.onboarding_steps. */
export function firstPendingStep(done: Record<string, unknown> | null | undefined): WizardStep {
  return WIZARD_STEPS.find((step) => step !== "listo" && !done?.[step]) ?? "listo";
}

/** Pasos hechos de los tres que se configuran (para «2/3» en el inicio). */
export function doneCount(done: Record<string, unknown> | null | undefined): number {
  return WIZARD_STEPS.filter((step) => step !== "listo" && done?.[step]).length;
}
