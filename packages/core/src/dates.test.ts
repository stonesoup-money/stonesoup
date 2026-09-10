import { describe, expect, it } from "vitest";
import { assertIsoDateTime, isIsoDate, isIsoDateTime, nowIso } from "./dates.js";

describe("dates (ISO 8601)", () => {
  it("nowIso produces a value that passes isIsoDateTime", () => {
    expect(isIsoDateTime(nowIso())).toBe(true);
  });

  it("accepts ISO 8601 datetimes with milliseconds and a Z suffix", () => {
    expect(isIsoDateTime("2026-09-10T10:04:52.138Z")).toBe(true);
    expect(isIsoDateTime("2026-09-10T10:04:52Z")).toBe(true);
  });

  it("rejects the non-ISO format that datetime('now') would produce", () => {
    expect(isIsoDateTime("2026-09-10 10:04:52")).toBe(false);
  });

  it("rejects non-datetime strings and non-strings", () => {
    expect(isIsoDateTime("not a date")).toBe(false);
    expect(isIsoDateTime(1_757_499_892_138)).toBe(false);
  });

  it("isIsoDate checks the date-only form", () => {
    expect(isIsoDate("2026-09-10")).toBe(true);
    expect(isIsoDate("2026-09-10T10:04:52Z")).toBe(false);
  });

  it("assertIsoDateTime throws with a labeled message", () => {
    expect(() => assertIsoDateTime("nope", "purchased_at")).toThrow(/purchased_at/);
  });
});
