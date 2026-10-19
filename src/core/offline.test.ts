import { afterEach, describe, expect, it, vi } from "vitest";
import { readCache, withOfflineCache, writeCache } from "./offline";

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe("copia local para arrancar sin conexión", () => {
  it("guarda la respuesta buena", async () => {
    await withOfflineCache("k", async () => [1, 2])();
    expect(readCache("k")).toEqual([1, 2]);
  });

  it("con error de red devuelve la copia", async () => {
    writeCache("k", "copia");
    await expect(withOfflineCache("k", () => Promise.reject(new TypeError("Failed to fetch")))()).resolves.toBe("copia");
  });

  it("un rechazo del servidor no se tapa con la copia", async () => {
    writeCache("k", "copia");
    await expect(withOfflineCache("k", () => Promise.reject(new Error("permission denied")))()).rejects.toThrow("permission denied");
  });

  it("sin copia, el error de red se propaga", async () => {
    await expect(withOfflineCache("k", () => Promise.reject(new TypeError("Failed to fetch")))()).rejects.toThrow("Failed to fetch");
  });

  it("si el servidor tarda, usa la copia y la actualiza cuando responde", async () => {
    vi.useFakeTimers();
    writeCache("k", "vieja");
    let answer: (v: string) => void = () => undefined;
    const slow = new Promise<string>((resolve) => (answer = resolve));
    const result = withOfflineCache("k", () => slow)();
    await vi.advanceTimersByTimeAsync(4000);
    await expect(result).resolves.toBe("vieja");
    answer("nueva");
    await vi.runAllTimersAsync();
    expect(readCache("k")).toBe("nueva");
  });
});
