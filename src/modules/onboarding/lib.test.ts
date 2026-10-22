import { describe, expect, it } from "vitest";
import { inviteEntitlements, parseSignupCode, showTrialNotice, signupUrl, trialDaysLeft } from "./lib";

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
