/**
 * Money is always an integer number of cents — never a float, never a
 * pre-formatted string. See AGENTS.md, Data conventions #1.
 *
 * These helpers exist so "format at the render edge only" has one place to
 * live instead of being reinvented per component.
 */

export function isValidCents(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value);
}

export function assertCents(value: unknown, label = "value"): number {
  if (!isValidCents(value)) {
    throw new TypeError(`${label} must be an integer number of cents, got ${String(value)}`);
  }
  return value;
}

export function addCents(...values: readonly number[]): number {
  return values.reduce((sum, v) => sum + assertCents(v, "addCents argument"), 0);
}

/**
 * Render-edge formatting only. Never store or compare against this output —
 * it is for display, not arithmetic.
 */
export function formatCents(cents: number, currency = "USD", locale = "en-US"): string {
  assertCents(cents, "cents");
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}
