/**
 * Dates are ISO 8601 strings everywhere — SQLite has no date type, so this
 * is the convention that replaces one. See AGENTS.md, Data conventions #2.
 *
 * The D1 schema's CHECK constraints use `strftime('%Y-%m-%dT%H:%M:%fZ','now')`
 * for defaults (never `datetime('now')`, which emits a non-ISO
 * "YYYY-MM-DD HH:MM:SS"). `Date.prototype.toISOString()` produces the same
 * shape from JavaScript, so the two are interchangeable at the write path.
 */

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function nowIso(): string {
  return new Date().toISOString();
}

export function isIsoDateTime(value: unknown): value is string {
  return typeof value === "string" && ISO_DATETIME_RE.test(value);
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE_RE.test(value);
}

export function assertIsoDateTime(value: unknown, label = "value"): string {
  if (!isIsoDateTime(value)) {
    throw new TypeError(`${label} must be an ISO 8601 datetime string, got ${String(value)}`);
  }
  return value;
}

/**
 * `receipts.purchased_at` accepts two shapes, not one (review round 1,
 * finding 4; migrations/0001_initial_schema.sql's column comment): a full
 * ISO 8601 datetime, or a date-only `YYYY-MM-DD` when a receipt (a photo,
 * or an order-confirmation email) prints only a local date and no time or
 * timezone. `assertIsoDateTime` rejects that second shape outright — using
 * it at the `purchased_at` write path throws on every photo receipt that
 * carries only a printed date (review round 2, finding 5). Use
 * `isPurchaseDate` / `assertPurchaseDate` for `purchased_at` specifically;
 * every other timestamp column stays on `isIsoDateTime` / `assertIsoDateTime`.
 */
export function isPurchaseDate(value: unknown): value is string {
  return isIsoDateTime(value) || isIsoDate(value);
}

export function assertPurchaseDate(value: unknown, label = "purchased_at"): string {
  if (!isPurchaseDate(value)) {
    throw new TypeError(
      `${label} must be an ISO 8601 datetime or a date-only YYYY-MM-DD string, got ${String(value)}`,
    );
  }
  return value;
}
