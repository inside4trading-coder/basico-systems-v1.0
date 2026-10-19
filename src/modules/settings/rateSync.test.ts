import { describe, expect, it } from "vitest";
import { RATE_MAX_AGE_MS, RATE_RETRY_MS, shouldSyncRate } from "./rateSync";

const now = Date.parse("2026-10-19T15:00:00Z");
const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString();

describe("sincronizar la tasa", () => {
  it("sin tasa, la pide", () => {
    expect(shouldSyncRate({ rate: null, now, lastAttempt: null, online: true })).toBe(true);
  });

  it("con tasa reciente, no", () => {
    expect(shouldSyncRate({ rate: { source: "bcv", fetched_at: hoursAgo(1) }, now, lastAttempt: null, online: true })).toBe(false);
  });

  it("con tasa de hace más de 3 horas, sí", () => {
    expect(RATE_MAX_AGE_MS).toBe(3 * 3600_000);
    expect(shouldSyncRate({ rate: { source: "dolarapi", fetched_at: hoursAgo(4) }, now, lastAttempt: null, online: true })).toBe(true);
  });

  it("la tasa manual del negocio no se toca", () => {
    expect(shouldSyncRate({ rate: { source: "manual", fetched_at: hoursAgo(48) }, now, lastAttempt: null, online: true })).toBe(false);
  });

  it("no reintenta antes de una hora ni sin conexión", () => {
    expect(RATE_RETRY_MS).toBe(3600_000);
    expect(shouldSyncRate({ rate: null, now, lastAttempt: now - 10 * 60_000, online: true })).toBe(false);
    expect(shouldSyncRate({ rate: null, now, lastAttempt: now - 61 * 60_000, online: true })).toBe(true);
    expect(shouldSyncRate({ rate: null, now, lastAttempt: null, online: false })).toBe(false);
  });
});
