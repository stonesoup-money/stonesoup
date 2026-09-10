import { describe, expect, it } from "vitest";
import { receiptR2Key } from "./r2.js";

describe("receiptR2Key (AGENTS.md, Data conventions #6: {userId}/{yyyy}/{mm}/{receiptUuid})", () => {
  it("builds the key in the documented shape", () => {
    const key = receiptR2Key("user-1", new Date(Date.UTC(2026, 8, 10)), "receipt-uuid-1");
    expect(key).toBe("user-1/2026/09/receipt-uuid-1");
  });

  it("zero-pads a single-digit month", () => {
    const key = receiptR2Key("user-1", new Date(Date.UTC(2026, 0, 5)), "r1");
    expect(key).toBe("user-1/2026/01/r1");
  });

  it("uses the UTC month, not local", () => {
    // Dec 31 23:59 UTC must not roll into January in a non-UTC test runner.
    const key = receiptR2Key("user-1", new Date(Date.UTC(2026, 11, 31, 23, 59)), "r1");
    expect(key).toBe("user-1/2026/12/r1");
  });
});
