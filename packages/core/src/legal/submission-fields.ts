/**
 * The golden-set submission field allowlist — pure metadata, three lists
 * of column *names*, nothing else. This module contains no code that
 * reads a `golden_set` row, constructs a payload, pseudonymizes a value,
 * or talks to any endpoint; it exists solely so /data-promise's "what
 * actually leaves your machine" claim and its evidence table row can be
 * checked by a test against the real schema (review round 1, finding 3),
 * the same way the STON-13 gate's read-only `PRAGMA table_info` check
 * already does for the "what never leaves" claim. Writing the submission
 * client itself is STON-9 and is human-gated — this file is prose about
 * field names, not that client.
 *
 * Every `golden_set` column (see migrations/0001_initial_schema.sql) must
 * appear in exactly one of the three lists below. That invariant is
 * enforced by packages/worker/src/public/policy-claims.test.ts against a
 * live `PRAGMA table_info(golden_set)` result — a column added to the
 * table with no entry here fails `pnpm check` instead of silently riding
 * along in (or silently being left out of) the description of what
 * leaves this instance.
 */

/**
 * Columns whose value is copied into the submission payload as-is. These
 * are the fields data-promise.ts's "What actually leaves your machine"
 * section names one by one.
 */
export const GOLDEN_SET_SUBMISSION_ALLOWLIST: readonly string[] = [
  "raw_string",
  "merchant_type",
  "model_category",
  "model_subcategory",
  "model_confidence",
  "verdict",
  "corrected_category",
  "corrected_subcategory",
  "routing_reason",
  "taxonomy_version",
  "schema_version",
  "split",
];

/**
 * Columns whose real value never crosses the instance boundary, but
 * whose *presence* is the point — a per-instance pseudonym stands in for
 * `labeler` in the payload instead (decisions.md, "when is `labeler`
 * pseudonymized?"). Listed separately from the allowlist above because
 * the payload does carry something derived from this column, just never
 * the column's own value.
 */
export const GOLDEN_SET_SUBMISSION_PSEUDONYMIZED_COLUMNS: readonly string[] = ["labeler"];

/**
 * Columns that are local bookkeeping only and never appear in the
 * submission payload in any form, pseudonymized or otherwise: `id` and
 * `submitted_at` are this instance's own row-tracking, and `created_at`
 * — a per-label timestamp — is excluded deliberately, not by oversight:
 * sitting next to a per-labeler pseudonym in a CC0-published dataset, a
 * precise timestamp is a re-identification handle (decisions.md, same
 * section as above). If a coarsened value (a month, never a full
 * timestamp) is ever added to the payload, it belongs in the allowlist
 * above as its own explicitly-named field, not as this column let
 * through unmodified.
 */
export const GOLDEN_SET_SUBMISSION_EXCLUDED_COLUMNS: readonly string[] = [
  "id",
  "created_at",
  "submitted_at",
];
