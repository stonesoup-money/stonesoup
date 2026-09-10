import { describe, expect, it } from "vitest";
import { evaluateChecksum } from "./checksum.js";
import { checksumToleranceCents } from "./config.js";

describe("evaluateChecksum (AGENTS.md, Data conventions #4; Review invariant 17)", () => {
  it("passes when the sum matches exactly", () => {
    const result = evaluateChecksum({
      lineItemCents: [500, 300],
      taxCents: 64,
      statedTotalCents: 864,
    });
    expect(result.result).toBe("pass");
    expect(result.deltaCents).toBe(0);
  });

  it("passes at exactly the 2-cent floor", () => {
    const result = evaluateChecksum({
      lineItemCents: [100],
      taxCents: 0,
      statedTotalCents: 98, // delta = 2 cents, tolerance = max(2, 0.5%) = 2
    });
    expect(result.result).toBe("pass");
    expect(result.deltaCents).toBe(2);
  });

  it("fails just past the 2-cent floor", () => {
    const result = evaluateChecksum({
      lineItemCents: [100],
      taxCents: 0,
      statedTotalCents: 97, // delta = 3 cents > tolerance 2
    });
    expect(result.result).toBe("fail");
  });

  it("passes at exactly 0.5% of a large total", () => {
    const statedTotalCents = 10_000;
    const tolerance = checksumToleranceCents(statedTotalCents); // 50
    const result = evaluateChecksum({
      lineItemCents: [10_000 + tolerance],
      taxCents: 0,
      statedTotalCents,
    });
    expect(result.result).toBe("pass");
  });

  it("does not double-count fees — fees-adjustments lines are already in lineItemCents", () => {
    // A $1.05 bag fee is passed as a line item, not a separate fees term.
    const result = evaluateChecksum({
      lineItemCents: [1000, 105],
      taxCents: 0,
      statedTotalCents: 1105,
    });
    expect(result.result).toBe("pass");
    expect(result.deltaCents).toBe(0);
  });

  it("treats a null tax as 0", () => {
    const result = evaluateChecksum({
      lineItemCents: [500],
      taxCents: null,
      statedTotalCents: 500,
    });
    expect(result.result).toBe("pass");
  });

  it("is not_run when statedTotalCents is null", () => {
    const result = evaluateChecksum({
      lineItemCents: [500],
      taxCents: 0,
      statedTotalCents: null,
    });
    expect(result.result).toBe("not_run");
    expect(result.deltaCents).toBeNull();
    expect(result.toleranceCents).toBeNull();
  });

  it("handles an empty line-item list", () => {
    const result = evaluateChecksum({ lineItemCents: [], taxCents: 0, statedTotalCents: 0 });
    expect(result.result).toBe("pass");
  });
});
