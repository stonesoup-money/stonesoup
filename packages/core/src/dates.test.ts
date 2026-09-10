import { describe, expect, it } from "vitest";
import {
  assertIsoDateTime,
  assertPurchaseDate,
  isIsoDate,
  isIsoDateTime,
  isPurchaseDate,
  nowIso,
} from "./dates.js";

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

  // Labeled `extracted_at`, not `purchased_at` (review round 2, finding
  // 5): `assertIsoDateTime` rejects the date-only shape purchased_at must
  // accept, so using purchased_at as this function's example label was
  // misleading. `extracted_at` is a real single-shape ISO datetime column.
  it("assertIsoDateTime throws with a labeled message", () => {
    expect(() => assertIsoDateTime("nope", "extracted_at")).toThrow(/extracted_at/);
  });
});

// review round 1, finding 4 / review round 2, finding 5: purchased_at is
// the one column with two accepted shapes — a full ISO 8601 datetime, or a
// date-only YYYY-MM-DD when a receipt only ever printed a date.
describe("purchase dates (purchased_at's two accepted shapes)", () => {
  it("isPurchaseDate accepts a full ISO 8601 datetime", () => {
    expect(isPurchaseDate("2026-09-10T10:04:52.138Z")).toBe(true);
  });

  it("isPurchaseDate accepts a date-only YYYY-MM-DD value", () => {
    expect(isPurchaseDate("2026-09-10")).toBe(true);
  });

  it("isPurchaseDate rejects a value matching neither shape", () => {
    expect(isPurchaseDate("09/10/2026")).toBe(false);
    expect(isPurchaseDate("2026-09-10 10:04:52")).toBe(false);
  });

  it("assertPurchaseDate returns a date-only value unchanged", () => {
    expect(assertPurchaseDate("2026-09-10")).toBe("2026-09-10");
  });

  it("assertPurchaseDate throws with a labeled message for an invalid value", () => {
    expect(() => assertPurchaseDate("nope", "purchased_at")).toThrow(/purchased_at/);
  });

  it("assertPurchaseDate defaults its label to purchased_at", () => {
    expect(() => assertPurchaseDate("nope")).toThrow(/purchased_at/);
  });
});
