/**
 * The review verdict write path (AGENTS.md, House rules: "the golden set
 * is the product, not a by-product" — Review invariant 16). A verdict
 * writes its `golden_set` record **immediately**, in the same
 * `db.batch()` that resolves the `review_queue` row — never a later
 * batch job.
 *
 * Every verdict — including `skipped` — writes a `golden_set` row.
 * `golden_set.verdict`'s own CHECK constraint (migration 0001) lists
 * `'skipped'` alongside `'confirmed'` and `'corrected'`, and
 * `/data-promise`'s "a skipped item is never sent" is a *submission*
 * (instance-boundary) constraint, not a local-write one — writing the row
 * here and filtering it at submission time satisfies both. A skip that
 * wrote nothing locally left reviewer work permanently unrecoverable:
 * gone from the queue (`resolved_at` set, `/api/review/next` filters
 * resolved rows) and absent from the dataset, with no re-queue path.
 *
 * An already-resolved `review_queue` row is rejected up front
 * (`row.resolved_at !== null` → `{ ok: false, error: "already-resolved" }`)
 * before any statement is built, so a second verdict on the same
 * `queueId` — reachable from the keyboard as `S` then `Y`, or from a
 * retried request — never touches `line_items`. Each of the three
 * statements *also* carries its own `resolved_at IS NULL` guard (the
 * `line_items` UPDATE via a subquery against `review_queue`, since it has
 * no `resolved_at` column of its own), evaluated against the row's state
 * as it stood before this batch started, so a second transaction that
 * loses a race with a concurrent one still writes and updates zero rows
 * once the first has committed.
 *
 * Order, and why it is the idempotency proof:
 *
 *   1. `INSERT INTO golden_set (...) SELECT ... FROM review_queue rq JOIN
 *      line_items li ... WHERE rq.id = ? AND rq.resolved_at IS NULL` — the
 *      SELECT sources only `review_queue` and `line_items`, **never**
 *      `receipts`, so no receipt id, user id, store, or purchase
 *      timestamp is even in scope (Review invariant 3). All fields are
 *      read pre-update, which is why this runs first.
 *   2. `UPDATE line_items SET status = ..., category = ..., subcategory =
 *      ..., updated_at = ... WHERE id = ? AND EXISTS (SELECT 1 FROM
 *      review_queue WHERE id = ? AND resolved_at IS NULL)` — never naming
 *      `raw_text`. Skipped for a `skipped` verdict (the `line_items.status`
 *      CHECK has no `'skipped'` value, so a skip leaves `status`,
 *      `category`, and `subcategory` untouched rather than forced into a
 *      status that doesn't describe what happened). This runs *before*
 *      step 3 clears the guard both of them read.
 *   3. `UPDATE review_queue SET verdict, ..., resolved_at WHERE id = ? AND
 *      resolved_at IS NULL` — last, because this is the statement that
 *      flips the guard steps 1 and 2 both depend on.
 *
 * Because step 3 runs last, steps 1 and 2 both see the pre-transaction
 * `resolved_at`, so a replayed or raced verdict inserts and updates zero
 * rows.
 */

import { isCategorySlug, isSubcategorySlug, nowIso } from "@stonesoup/core";

export type Verdict = "confirmed" | "corrected" | "skipped";

export interface VerdictInput {
  queueId: string;
  verdict: Verdict;
  correctedCategory?: string | null;
  correctedSubcategory?: string | null;
  labeler: string;
}

export type VerdictOutcome =
  | { ok: true; goldenSetWritten: boolean }
  | { ok: false; error: "not-found" }
  | { ok: false; error: "already-resolved" }
  | { ok: false; error: "invalid-corrected-category" }
  | { ok: false; error: "invalid-corrected-subcategory" };

interface ReviewQueueLookupRow {
  id: string;
  line_item_id: string;
  resolved_at: string | null;
  category: string;
  subcategory: string | null;
}

export async function writeVerdict(db: D1Database, input: VerdictInput): Promise<VerdictOutcome> {
  const row = await db
    .prepare(
      `SELECT rq.id, rq.line_item_id, rq.resolved_at, li.category, li.subcategory
         FROM review_queue rq
         JOIN line_items li ON li.id = rq.line_item_id
        WHERE rq.id = ?`,
    )
    .bind(input.queueId)
    .first<ReviewQueueLookupRow>();

  if (!row) {
    return { ok: false, error: "not-found" };
  }

  // Reject a second verdict on an already-resolved row up front, before any
  // statement is built — this is what stops `S` then `Y` (or a retried
  // request) from silently rewriting `line_items` with no `golden_set` row
  // (Review invariant 16).
  if (row.resolved_at !== null) {
    return { ok: false, error: "already-resolved" };
  }

  let finalCategory = row.category;
  let finalSubcategory = row.subcategory;
  if (input.verdict === "corrected") {
    if (input.correctedCategory) {
      if (!isCategorySlug(input.correctedCategory)) {
        return { ok: false, error: "invalid-corrected-category" };
      }
      finalCategory = input.correctedCategory;
    }
    if (input.correctedSubcategory) {
      if (!isSubcategorySlug(finalCategory, input.correctedSubcategory)) {
        return { ok: false, error: "invalid-corrected-subcategory" };
      }
      finalSubcategory = input.correctedSubcategory;
    } else {
      finalSubcategory = null;
    }
  }

  const now = nowIso();
  const statements: D1PreparedStatement[] = [];

  // Every verdict — including `skipped` — writes a golden_set record. See
  // the module header: `/data-promise`'s "never sent" is a submission-time
  // constraint, not a local-write one, and the schema's CHECK constraint
  // was built to hold this value.
  statements.push(
    db
      .prepare(
        `INSERT INTO golden_set (
           id, raw_string, model_category, model_subcategory, model_confidence,
           verdict, corrected_category, corrected_subcategory, labeler,
           routing_reason, taxonomy_version, schema_version
         )
         SELECT ?, li.raw_text, li.category, li.subcategory, li.confidence,
                ?, ?, ?, ?,
                rq.reason, li.taxonomy_version, 1
           FROM review_queue rq
           JOIN line_items li ON li.id = rq.line_item_id
          WHERE rq.id = ? AND rq.resolved_at IS NULL`,
      )
      .bind(
        crypto.randomUUID(),
        input.verdict,
        input.verdict === "corrected" ? finalCategory : null,
        input.verdict === "corrected" ? finalSubcategory : null,
        input.labeler,
        input.queueId,
      ),
  );

  if (input.verdict !== "skipped") {
    statements.push(
      db
        .prepare(
          `UPDATE line_items SET status = ?, category = ?, subcategory = ?, updated_at = ?
            WHERE id = ? AND EXISTS (
              SELECT 1 FROM review_queue WHERE id = ? AND resolved_at IS NULL
            )`,
        )
        .bind(
          input.verdict === "corrected" ? "corrected" : "confirmed",
          finalCategory,
          finalSubcategory,
          now,
          row.line_item_id,
          input.queueId,
        ),
    );
  }

  // Last: this is the statement that flips the `resolved_at IS NULL` guard
  // the two statements above both depend on.
  statements.push(
    db
      .prepare(
        `UPDATE review_queue
            SET verdict = ?, corrected_category = ?, corrected_subcategory = ?, labeler = ?, resolved_at = ?
          WHERE id = ? AND resolved_at IS NULL`,
      )
      .bind(
        input.verdict,
        input.verdict === "corrected" ? finalCategory : null,
        input.verdict === "corrected" ? finalSubcategory : null,
        input.labeler,
        now,
        input.queueId,
      ),
  );

  const results = await db.batch(statements);

  // Round 2, finding 7: `goldenSetWritten` was hardcoded `true` rather
  // than derived from what the golden_set INSERT (always `statements[0]`
  // — see the ordering note in the module header) actually inserted. The
  // guard above only rejects a row this function's *own* read already saw
  // resolved; a concurrent writer that resolves the same `queueId`
  // between that read and this `db.batch()` makes the guarded INSERT's
  // `WHERE rq.resolved_at IS NULL` match zero rows, and the old hardcoded
  // value reported a golden-set write that never happened.
  const goldenSetWritten = (results[0]?.meta.changes ?? 0) > 0;

  return { ok: true, goldenSetWritten };
}
