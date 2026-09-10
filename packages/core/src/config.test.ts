import { describe, expect, it } from "vitest";
import {
  CHECKSUM_TOLERANCE_MIN_CENTS,
  CHECKSUM_TOLERANCE_PERCENT,
  checksumToleranceCents,
} from "./config.js";

// The checksum correction (decisions.md) was specifically about this
// formula — it had zero test coverage before review round 1, finding 13.
describe("checksumToleranceCents", () => {
  it("floors at the minimum for a small stated total", () => {
    // 0.5% of $1.00 is 0.5 cents, well under the 2-cent floor.
    expect(checksumToleranceCents(100)).toBe(CHECKSUM_TOLERANCE_MIN_CENTS);
  });

  it("uses the percentage once it exceeds the minimum", () => {
    // 0.5% of $100.00 (10000 cents) is 50 cents.
    expect(checksumToleranceCents(10_000)).toBe(50);
  });

  it("matches the exact AGENTS.md formula: max(2 cents, 0.5% of total)", () => {
    const statedTotalCents = 43_217;
    const expected = Math.max(
      CHECKSUM_TOLERANCE_MIN_CENTS,
      Math.round(CHECKSUM_TOLERANCE_PERCENT * statedTotalCents),
    );
    expect(checksumToleranceCents(statedTotalCents)).toBe(expected);
  });

  it("rounds to the nearest cent rather than truncating", () => {
    // 0.5% of 12345 cents is 61.725 — rounds to 62, not 61.
    expect(checksumToleranceCents(12_345)).toBe(62);
  });

  it("handles a zero total without throwing", () => {
    expect(checksumToleranceCents(0)).toBe(CHECKSUM_TOLERANCE_MIN_CENTS);
  });
});
