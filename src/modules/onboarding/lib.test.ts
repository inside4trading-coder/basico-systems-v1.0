import { describe, expect, it } from "vitest";
import {
  cleanRecipients,
  doneCount,
  firstPendingStep,
  inviteEntitlements,
  parseSignupCode,
  recipientsProblem,
  showTrialNotice,
  signupUrl,
  trialDaysLeft,
} from "./lib";

describe("trialDaysLeft", () => {
  const now = new Date("2026-10-22T12:00:00Z");

  it("sin fecha no hay prueba", () => {
    expect(trialDaysLeft(null, now)).toBeNull();
  });

  it("redondea hacia arriba los días que quedan", () => {
    expect(trialDaysLeft("2026-10-29T13:00:00Z", now)).toBe(8);
    expect(trialDaysLeft("2026-10-22T18:00:00Z", now)).toBe(1);
  });

  it("negativo cuando ya venció", () => {
    expect(trialDaysLeft("2026-10-20T12:00:00Z", now)).toBe(-2);
  });
});

describe("showTrialNotice", () => {
  it("solo la última semana", () => {
    expect(showTrialNotice(null)).toBe(false);
    expect(showTrialNotice(8)).toBe(false);
    expect(showTrialNotice(7)).toBe(true);
    expect(showTrialNotice(-1)).toBe(true);
  });
});

describe("inviteEntitlements", () => {
  it("guarda solo lo distinto del plan base", () => {
    expect(inviteEntitlements({ pos: true, fichaje: true, max_users: 5, max_locations: 2 })).toEqual({
      fichaje: true,
      max_locations: 2,
    });
  });

  it("vacío si es el plan base", () => {
    expect(inviteEntitlements({ estudio: false, max_registers: 2 })).toEqual({});
  });
});

describe("parseSignupCode", () => {
  const code = "0123456789abcdef01234567";

  it("acepta el código o la URL completa", () => {
    expect(parseSignupCode(code)).toBe(code);
    expect(parseSignupCode(`https://app.test/alta/${code.toUpperCase()}`)).toBe(code);
  });

  it("rechaza lo que no es un código", () => {
    expect(parseSignupCode("abc")).toBeNull();
    expect(parseSignupCode(`${code}0`)).toBeNull();
  });

  it("arma la URL del enlace", () => {
    expect(signupUrl(code, "https://app.test")).toBe(`https://app.test/alta/${code}`);
  });
});

describe("firstPendingStep", () => {
  it("arranca por el negocio", () => {
    expect(firstPendingStep(null)).toBe("negocio");
    expect(firstPendingStep({})).toBe("negocio");
  });

  it("retoma donde quedó, aunque haya saltos", () => {
    expect(firstPendingStep({ negocio: "2026-10-22" })).toBe("productos");
    expect(firstPendingStep({ negocio: "x", equipo: "x" })).toBe("productos");
    expect(firstPendingStep({ negocio: "x", productos: "x" })).toBe("equipo");
  });

  it("con los tres pasos hechos queda en «listo»", () => {
    expect(firstPendingStep({ negocio: "x", productos: "x", equipo: "x" })).toBe("listo");
  });

  it("cuenta los pasos hechos", () => {
    expect(doneCount({ negocio: "x", equipo: "x", listo: "x" })).toBe(2);
    expect(doneCount(undefined)).toBe(0);
  });
});

describe("recipientsProblem", () => {
  it("sin correos el enlace queda abierto", () => {
    expect(recipientsProblem([{ email: " ", role: "owner" }])).toBeNull();
  });
  it("pide un dueño, correos válidos y sin repetir", () => {
    expect(recipientsProblem([{ email: "a@x.co", role: "admin" }])).toBe("Al menos un correo tiene que ser de un dueño");
    expect(recipientsProblem([{ email: "a@x", role: "owner" }])).toBe("Correo no válido: a@x");
    expect(recipientsProblem([{ email: "a@x.co", role: "owner" }, { email: "A@x.co ", role: "admin" }])).toBe("Correo repetido: a@x.co");
    expect(recipientsProblem([{ email: "a@x.co", role: "owner" }, { email: "b@x.co", role: "admin" }])).toBeNull();
  });
  it("hasta 5 correos", () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ email: `u${i}@x.co`, role: i === 0 ? ("owner" as const) : ("admin" as const) }));
    expect(recipientsProblem(six)).toBe("Hasta 5 correos por enlace");
  });
  it("limpia espacios, mayúsculas y filas vacías", () => {
    expect(cleanRecipients([{ email: " A@X.co ", role: "owner" }, { email: "", role: "admin" }])).toEqual([{ email: "a@x.co", role: "owner" }]);
  });
});
