import { describe, expect, it } from "vitest";
import { createBurstDetector, IDLE_MS, normalizeScannedCode } from "./burst";

function fakeClock() {
  let now = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  return {
    now: () => now,
    setTimeout: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimeout: (id: unknown) => {
      timers = timers.filter((t) => t.id !== id);
    },
    advance(ms: number) {
      now += ms;
      const due = timers.filter((t) => t.at <= now);
      timers = timers.filter((t) => t.at > now);
      due.forEach((t) => t.fn());
    },
  };
}

function type(detector: ReturnType<typeof createBurstDetector>, clock: ReturnType<typeof fakeClock>, text: string, gapMs: number) {
  const consumed: boolean[] = [];
  for (const key of text) {
    clock.advance(gapMs);
    consumed.push(detector.handleKey({ key }));
  }
  return consumed;
}

describe("detector de pistola", () => {
  it("una ráfaga con Enter es una lectura y el Enter no llega al campo", () => {
    const clock = fakeClock();
    const scans: string[] = [];
    const d = createBurstDetector((c) => scans.push(c), clock);
    type(d, clock, "7591234567890", 8);
    clock.advance(8);
    expect(d.handleKey({ key: "Enter" })).toBe(true);
    expect(scans).toEqual(["7591234567890"]);
    clock.advance(IDLE_MS * 2);
    expect(scans).toHaveLength(1);
  });

  it("una pistola sin Enter al final también lee, tras una pausa corta", () => {
    const clock = fakeClock();
    const scans: string[] = [];
    const d = createBurstDetector((c) => scans.push(c), clock);
    type(d, clock, "WIX-01001", 10);
    expect(scans).toEqual([]);
    clock.advance(IDLE_MS);
    expect(scans).toEqual(["WIX-01001"]);
  });

  it("el tecleo humano no es lectura, con o sin Enter", () => {
    const clock = fakeClock();
    const scans: string[] = [];
    const d = createBurstDetector((c) => scans.push(c), clock);
    type(d, clock, "filtro", 150);
    clock.advance(IDLE_MS);
    clock.advance(150);
    expect(d.handleKey({ key: "Enter" })).toBe(false);
    expect(scans).toEqual([]);
  });

  it("menos de 4 caracteres no es lectura", () => {
    const clock = fakeClock();
    const scans: string[] = [];
    const d = createBurstDetector((c) => scans.push(c), clock);
    type(d, clock, "123", 5);
    clock.advance(5);
    expect(d.handleKey({ key: "Enter" })).toBe(false);
    expect(scans).toEqual([]);
  });

  it("los atajos de teclado se ignoran", () => {
    const clock = fakeClock();
    const scans: string[] = [];
    const d = createBurstDetector((c) => scans.push(c), clock);
    expect(d.handleKey({ key: "v", ctrlKey: true })).toBe(false);
    clock.advance(IDLE_MS);
    expect(scans).toEqual([]);
  });

  it("normaliza el guion de lectores con otra distribución de teclado", () => {
    expect(normalizeScannedCode(" WIX'01001 ")).toBe("WIX-01001");
    expect(normalizeScannedCode("NG´40037?12")).toBe("NG-40037-12");
  });
});
