/** Sugerencias de frases de comisión a partir de las salidas abiertas del banco. */

export interface FeeRuleLike {
  phrase: string;
  match: "starts" | "contains";
  is_active: boolean;
}

export interface FeeLineLike {
  direction: "in" | "out";
  status: string;
  description: string | null;
}

const LOOKS_LIKE_FEE = /\b(com|comision|comisión|cargo|itf|igtf|mantenimiento)\b/i;

export function ruleMatches(rule: FeeRuleLike, description: string | null): boolean {
  const p = rule.phrase.trim().toLowerCase();
  const d = (description ?? "").trim().toLowerCase();
  if (!p) return false;
  return rule.match === "contains" ? d.includes(p) : d.startsWith(p);
}

/** Primeras palabras (hasta 3) de las salidas abiertas que parecen comisión y ninguna frase cubre. */
export function feeSuggestions(lines: FeeLineLike[], rules: FeeRuleLike[]): { phrase: string; count: number }[] {
  const active = rules.filter((r) => r.is_active);
  const seen = new Map<string, number>();
  for (const l of lines) {
    if (l.direction !== "out" || (l.status !== "unmatched" && l.status !== "possible")) continue;
    const d = (l.description ?? "").trim();
    if (!LOOKS_LIKE_FEE.test(d) || active.some((r) => ruleMatches(r, d))) continue;
    const phrase = d.split(/\s+/).slice(0, 3).join(" ").toUpperCase();
    seen.set(phrase, (seen.get(phrase) ?? 0) + 1);
  }
  return [...seen.entries()]
    .map(([phrase, count]) => ({ phrase, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
}
