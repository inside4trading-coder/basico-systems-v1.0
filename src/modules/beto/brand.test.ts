import { BETO_NAME } from "./brand";

/**
 * El asistente se llama «[B]eto», sin excepciones. Esta guarda recorre la app,
 * las edge functions y las migraciones de [B]eto (desde la que fijó la marca)
 * y falla si aparece «Beto» suelto. Los identificadores (BetoPage, useSendBeto)
 * no cuentan porque no son palabra suelta.
 */
const LOOSE_NAME = /(?<!\[B\])\bBeto\b/;

// La migración original ya está aplicada en producción; sus textos los
// reemplaza 20261225000000_beto_marca.sql.
const APPLIED_BEFORE_BRAND = /20261224000000_beto\.sql$/;

const sources = {
  ...import.meta.glob(["/src/**/*.{ts,tsx}", "!/src/**/*.test.{ts,tsx}"], { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob(["/supabase/functions/**/*.ts", "!/supabase/functions/**/*.test.ts"], {
    query: "?raw",
    import: "default",
    eager: true,
  }),
  ...import.meta.glob("/supabase/migrations/*beto*.sql", { query: "?raw", import: "default", eager: true }),
} as Record<string, string>;

describe("marca de [B]eto", () => {
  it("el nombre en texto plano es [B]eto", () => {
    expect(BETO_NAME).toBe("[B]eto");
  });

  it("revisa la app, las edge functions y las migraciones", () => {
    const files = Object.keys(sources);
    expect(files.some((f) => f.endsWith("modules/beto/BetoParts.tsx"))).toBe(true);
    expect(files.some((f) => f.endsWith("functions/beto/index.ts"))).toBe(true);
    expect(files.some((f) => f.endsWith("20261225000000_beto_marca.sql"))).toBe(true);
  });

  it("nunca escribe «Beto» sin la B entre corchetes", () => {
    const offenders = Object.entries(sources)
      .filter(([file]) => !APPLIED_BEFORE_BRAND.test(file))
      .flatMap(([file, text]) =>
        text
          .split("\n")
          .map((line, i) => ({ file, line: i + 1, text: line.trim() }))
          .filter(({ text: line }) => LOOSE_NAME.test(line)),
      )
      .map(({ file, line, text }) => `${file}:${line} ${text}`);
    expect(offenders).toEqual([]);
  });
});
