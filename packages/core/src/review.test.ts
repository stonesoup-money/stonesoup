import { describe, expect, it } from "vitest";
import { routingReason } from "./review.js";

describe("routingReason precedence: checksum_fail > low_confidence > bootstrap", () => {
  it("checksum_fail wins even for a high-confidence item", () => {
    expect(
      routingReason({ confidence: 0.99 }, { receiptChecksumFailed: true, confidenceFloor: 0.85 }),
    ).toBe("checksum_fail");
  });

  it("low_confidence fires below the floor", () => {
    expect(
      routingReason({ confidence: 0.5 }, { receiptChecksumFailed: false, confidenceFloor: 0.85 }),
    ).toBe("low_confidence");
  });

  it("low_confidence fires when confidence is null", () => {
    expect(
      routingReason({ confidence: null }, { receiptChecksumFailed: false, confidenceFloor: 0.85 }),
    ).toBe("low_confidence");
  });

  it("bootstrap fires above the floor with a passing checksum", () => {
    expect(
      routingReason({ confidence: 0.95 }, { receiptChecksumFailed: false, confidenceFloor: 0.85 }),
    ).toBe("bootstrap");
  });
});
