import { describe, expect, it } from "vitest";
import { addCents, assertCents, formatCents, isValidCents } from "./money.js";

describe("money (integer cents)", () => {
  it("accepts integers, rejects floats and strings", () => {
    expect(isValidCents(199)).toBe(true);
    expect(isValidCents(1.99)).toBe(false);
    expect(isValidCents("199")).toBe(false);
    expect(isValidCents(Number.NaN)).toBe(false);
  });

  it("assertCents throws on non-integer input", () => {
    expect(() => assertCents(1.5)).toThrow(TypeError);
    expect(assertCents(500)).toBe(500);
  });

  it("addCents sums integer cents", () => {
    expect(addCents(100, 250, 4)).toBe(354);
    expect(addCents()).toBe(0);
  });

  it("addCents rejects a non-integer argument", () => {
    expect(() => addCents(100, 1.5)).toThrow(TypeError);
  });

  it("formatCents formats at the render edge only", () => {
    expect(formatCents(199)).toBe("$1.99");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(100000)).toBe("$1,000.00");
  });
});
