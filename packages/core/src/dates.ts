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
