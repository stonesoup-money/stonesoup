/**
 * The review verdict write path (AGENTS.md, House rules: "the golden set
 * is the product, not a by-product" — Review invariant 16). A verdict
 * writes its `golden_set` record **immediately**, in the same
 * `db.batch()` that resolves the `review_queue` row — never a later
 * batch job.
 *
 * Order, and why it is the idempotency proof:
 *
 *   1. `INSERT INTO golden_set (...) SELECT ... FROM review_queue rq JOIN
 *      line_items li ... WHERE rq.id = ? AND rq.resolved_at IS NULL` — the
 *      SELECT sources only `review_queue` and `line_items`, **never**
 *      `receipts`, so no receipt id, user id, store, or purchase
 *      timestamp is even in scope (Review invariant 3). All fields are
 *      read pre-update, which is why this runs first.
 *   2. `UPDATE review_queue SET verdict, ..., resolved_at WHERE id = ? AND
 *      resolved_at IS NULL`.
 *   3. `UPDATE line_items SET status = ..., category = ..., subcategory =
 *      ..., updated_at = ...` — never naming `raw_text`.
 *
 * The guarded INSERT runs before the UPDATE clears its own guard, so a
 * replayed verdict inserts zero rows and updates zero rows on retry.
 *
 * A `skipped` verdict runs step 2 only (D2, STON-2's plan): `/data-promise`
 * says "a skipped item is never sent", so no `golden_set` row is written,
 * and — since the `line_items.status` CHECK has no `'skipped'` value —
 * the line item's own `status`/`category`/`subcategory` are left
 * untouched rather than forced into one of the two verdict statuses that
 * do not describe what happened.
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
  | { ok: false; error: "invalid-corrected-category" };

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

  let finalCategory = row.category;
  let finalSubcategory = row.subcategory;
  if (input.verdict === "corrected") {
    if (input.correctedCategory) {
      if (!isCategorySlug(input.correctedCategory)) {
        return { ok: false, error: "invalid-corrected-category" };
      }
      finalCategory = input.correctedCategory;
    }
    finalSubcategory =
      input.correctedSubcategory && isSubcategorySlug(finalCategory, input.correctedSubcategory)
        ? input.correctedSubcategory
        : null;
  }

  const now = nowIso();
  const statements: D1PreparedStatement[] = [];

  // D2: a skipped verdict writes no golden_set record at all.
  const writeGoldenSet = input.verdict !== "skipped";
  if (writeGoldenSet) {
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
  }

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

  if (input.verdict !== "skipped") {
    statements.push(
      db
        .prepare(
          `UPDATE line_items SET status = ?, category = ?, subcategory = ?, updated_at = ? WHERE id = ?`,
        )
        .bind(
          input.verdict === "corrected" ? "corrected" : "confirmed",
          finalCategory,
          finalSubcategory,
          now,
          row.line_item_id,
        ),
    );
  }

  await db.batch(statements);

  return { ok: true, goldenSetWritten: writeGoldenSet };
}
