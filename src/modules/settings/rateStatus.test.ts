import { describe, expect, it } from "vitest";
import type { RateStatus } from "./api";
import { rateAlert, sourceLabel } from "./rateStatus";

const base: RateStatus = {
  rate_source: "bcv",
  current: { rate: 911.6243, source: "bcv", effective_date: "2026-11-13", fetched_at: "2026-11-12T22:00:00Z", stale: false },
  override: null,
  last_check: { at: "2026-11-13T15:00:00Z", ok: true, mode: "cron", source: "bcv", error: null },
  last_ok_at: "2026-11-13T15:00:00Z",
  last_error: null,
  failing: false,
  history: [],
};

describe("aviso de la tasa", () => {
  it("todo al día: sin aviso", () => {
    expect(rateAlert(base)).toBeNull();
  });

  it("sin tasa en modo BCV pide actualizar o poner una de emergencia", () => {
    const a = rateAlert({ ...base, current: null, last_error: { at: "x", error: "BCV: HTTP 503", mode: "cron" } });
    expect(a?.title).toBe("No hay tasa");
    expect(a?.detail).toContain("BCV: HTTP 503");
    expect(a?.detail).toContain("tasa de emergencia");
  });

  it("sin tasa en modo propio pide fijarla", () => {
    expect(rateAlert({ ...base, rate_source: "manual", current: null })?.detail).toContain("Fija tu tasa propia");
  });

  it("tasa vieja dice con qué tasa sigue cobrando", () => {
    const a = rateAlert({ ...base, current: { ...base.current!, stale: true } });
    expect(a?.title).toBe("La tasa está vieja");
    expect(a?.detail).toContain("911,62");
    expect(a?.detail).toContain("13 nov");
  });

  it("falla con tasa vigente: avisa el error y que reintenta", () => {
    const a = rateAlert({
      ...base,
      failing: true,
      last_check: { ...base.last_check!, ok: false, error: "BCV: no respondió a tiempo; DolarAPI USD: HTTP 500" },
    });
    expect(a?.title).toBe("Falló la última consulta de la tasa");
    expect(a?.detail).toMatch(/^BCV: no respondió a tiempo; DolarAPI USD: HTTP 500\. El POS sigue cobrando/);
    expect(a?.detail).toContain("cada hora");
  });

  it("con tasa de emergencia o propia no molesta", () => {
    const failing = { ...base, failing: true, current: { ...base.current!, stale: true } };
    expect(rateAlert({ ...failing, override: { rate: 950, note: null, created_at: "x", active: true } })).toBeNull();
    expect(rateAlert({ ...failing, rate_source: "manual" })).toBeNull();
  });
});

describe("fuente", () => {
  it("distingue la tasa de emergencia de la propia", () => {
    expect(sourceLabel("manual", true)).toBe("Tasa de emergencia");
    expect(sourceLabel("manual", false)).toBe("Tasa propia");
    expect(sourceLabel("dolarapi", false)).toBe("BCV vía DolarAPI");
  });
});
