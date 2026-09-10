/**
 * What the golden-set submission payload may contain — pure metadata,
 * name lists and nothing else. This module contains no code that reads a
 * `golden_set` row, constructs a payload, pseudonymizes a value, filters
 * a row, or talks to any endpoint; it exists solely so /data-promise's
 * "what actually leaves your machine" claim and its evidence table row
 * can be checked by a test against the real schema (review round 1,
 * finding 3), the same way the STON-13 gate's read-only
 * `PRAGMA table_info` check already does for the "what never leaves"
 * claim. Writing the submission client itself is STON-9 and is
 * human-gated — this file is prose about names, not that client.
 *
 * Two different questions, kept deliberately apart:
 *
 *   - **Which columns of a submitted row may leave** — the first three
 *     lists below (allowlisted / pseudonymized / excluded). Every
 *     `golden_set` column (see migrations/0001_initial_schema.sql) must
 *     appear in exactly one of them. That invariant is enforced by
 *     packages/worker/src/public/policy-claims.test.ts against a live
 *     `PRAGMA table_info(golden_set)` result — a column added to the
 *     table with no entry here fails `pnpm check` instead of silently
 *     riding along in (or silently being left out of) the description of
 *     what leaves this instance.
 *   - **Which rows may be submitted at all** —
 *     `GOLDEN_SET_SUBMISSION_EXCLUDED_VERDICTS`, last in this file. It is
 *     not part of the column exhaustiveness invariant above and must not
 *     be folded into it; see its own comment for why /data-promise's
 *     escape hatch depends on it.
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

/**
 * Verdict values whose **entire row** never crosses the instance
 * boundary (review round 3, finding 4). The three lists above answer
 * "which columns of a submitted row may leave"; this one answers "which
 * rows may be submitted at all", and those are not the same question —
 * `verdict` appearing in the allowlist above means "carried in the
 * payload of a row that is submitted", never "every verdict value is
 * submittable".
 *
 * Why this exists: /data-promise tells a privacy-conscious reader that
 * if a receipt line is something they would rather not contribute, the
 * move is to **skip** it during review, and that a skipped item is never
 * sent. Since review round 1 a skip is not a silent no-op —
 * packages/worker/src/review/verdict.ts writes a `golden_set` row for
 * every verdict, `'skipped'` included, carrying the raw line text. That
 * local write is deliberate (losing a reviewer's "not this one" outright
 * was its own bug) and it is consistent with the page, because "never
 * sent" is a claim about the *instance boundary*, not about the local
 * row — but it is only consistent for as long as the submission client
 * honours this list.
 *
 * STON-9's implementer: a row whose `verdict` is named here is not
 * submitted **at all**. Not with fields redacted, not with the raw
 * string dropped, not folded into an aggregate — the row does not
 * leave. That is the whole of what /data-promise's escape hatch
 * promises, and this constant is where the promise is written down, so
 * that it is a condition on the code rather than something to remember.
 *
 * Metadata, like the rest of this file: nothing here reads a
 * `golden_set` row or filters one. The submission client is STON-9 and
 * human-gated (AGENTS.md, Human gates).
 */
export const GOLDEN_SET_SUBMISSION_EXCLUDED_VERDICTS: readonly string[] = ["skipped"];
