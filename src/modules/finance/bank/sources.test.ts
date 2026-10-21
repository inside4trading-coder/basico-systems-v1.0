import { describe, expect, it } from "vitest";
import { lastLoadByAccount, sourceStatus } from "./sources";

describe("fuentes del centro de conciliación", () => {
  const now = new Date("2026-10-21T15:00:00Z");

  it("al día hasta 3 días, después atrasado", () => {
    expect(sourceStatus("2026-10-20T10:00:00Z", now)).toBe("ok");
    expect(sourceStatus("2026-10-18T16:00:00Z", now)).toBe("ok");
    expect(sourceStatus("2026-10-17T10:00:00Z", now)).toBe("late");
  });

  it("sin cargas, nunca cargado", () => {
    expect(sourceStatus(null, now)).toBe("never");
  });

  it("última carga por cuenta", () => {
    expect(
      lastLoadByAccount([
        { account_id: "a", created_at: "2026-10-10T00:00:00Z" },
        { account_id: "b", created_at: "2026-10-12T00:00:00Z" },
        { account_id: "a", created_at: "2026-10-19T00:00:00Z" },
      ]),
    ).toEqual({ a: "2026-10-19T00:00:00Z", b: "2026-10-12T00:00:00Z" });
  });
});
