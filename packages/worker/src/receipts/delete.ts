/**
 * Receipt delete — the child-first data-layer primitive (STON-18).
 *
 * STON-3 put `ON DELETE RESTRICT` (not CASCADE) on every FK a
 * `REPLACE`-induced delete would otherwise cascade through
 * (`migrations/0001_initial_schema.sql`'s header) — the production
 * defence against the banned REPLACE-based upsert silently destroying
 * data. RESTRICT fires on *any* delete, not only a REPLACE-induced one,
 * which has a consequence this ticket exists to close: the FK graph is
 * now child-first delete only. `review_queue` references `line_items`
 * references `receipts`; `receipt_sources` references both `receipts` and
 * `sources`. A bare `DELETE FROM receipts` on a receipt with any of those
 * children fails loudly with `FOREIGN KEY constraint failed` and no hint
 * about ordering — see `delete.test.ts`'s "the naive path still fails
 * loudly" case, which locks that failure mode in on purpose. The fix for
 * that failure is never to relax RESTRICT back to CASCADE (AGENTS.md
 * invariant #23 — that would silently reopen the banned REPLACE-based
 * upsert's data-loss channel review rounds 1-3 closed); the fix is to
 * delete in the order this module encodes, and the migration's own FK
 * comments point here.
 *
 * **Order, child-first:** `review_queue` → `line_items` → `receipt_sources`
 * → `receipts`. `sources` rows are never deleted by this path — a
 * disconnect is `UPDATE sources SET auth_state = 'disconnected'` (see the
 * `receipt_sources` table comment in the migration); a receipt delete may
 * leave a `sources` row with no `receipt_sources` link, and that is
 * correct, not a leak.
 *
 * **Golden-set records survive a receipt delete, deliberately and
 * permanently.** `golden_set` has no `receipt_id`, no `user_id`, and no
 * purchase timestamp — the anonymization boundary is enforced by the
 * absence of those columns (AGENTS.md invariant #3; migration `golden_set`
 * header). Identifying "the labels that came from this receipt" would
 * require either adding a link column (the exact boundary violation the
 * table exists to prevent) or matching on `raw_string` (which would also
 * delete labels derived from an unrelated receipt carrying the identical
 * printed line). There is no correct query, so this module contains none:
 * it never reads or writes `golden_set`. Deleting a receipt does destroy
 * its `review_queue` rows, including resolved verdicts — that is safe
 * precisely because a verdict already wrote its `golden_set` record
 * immediately, in the same step it was resolved (AGENTS.md, "the golden
 * set is the product"; invariant #16), so no labelling work is lost by a
 * receipt delete.
 *
 * **R2 ordering, deliberate.** The D1 batch commits first; the R2 object
 * is deleted second. The reverse would leave a `receipts` row pointing at
 * a missing image if the D1 batch then failed. This order's own failure
 * mode is the opposite and more recoverable one: the D1 batch commits but
 * the R2 delete fails, leaving an orphaned R2 object. That failure is
 * never swallowed here — `deleteReceipt` does not wrap the R2 delete in a
 * `try` that reports success regardless, so a failed R2 delete rejects the
 * returned promise instead of silently lying that the image is gone. The
 * key convention stays `{userId}/{yyyy}/{mm}/{receiptUuid}` (AGENTS.md,
 * Data conventions #6); this primitive uses `receipts.r2_key` exactly as
 * stored rather than recomputing it.
 *
 * **No caller exists yet, and this is deliberate, not an oversight —
 * following STON-11's `linkOrMerge` precedent.** There is no session, no
 * user identity, and no ingest path anywhere in this tree today
 * (`packages/worker/src/index.ts` routes exactly `/api/health`,
 * `/api/byok/status`, and the three public legal pages). A delete route
 * added now would be reachable, unauthenticated, on a public Worker, with
 * no ownership check to write against. This module ships the primitive
 * and its test coverage only; wiring it to an authenticated route with an
 * ownership check and a confirm interaction belongs to whichever ticket
 * owns the receipt-detail screen, once auth (STON-4) exists.
 */

export function deleteReceiptStatements(db: D1Database, receiptId: string): D1PreparedStatement[] {
  return [
    // 1. review_queue rows for this receipt's line items — including
    // resolved verdicts. Safe: the verdict already wrote its golden_set
    // record immediately, in the same step (see module doc above).
    db
      .prepare(
        `DELETE FROM review_queue WHERE line_item_id IN (SELECT id FROM line_items WHERE receipt_id = ?)`,
      )
      .bind(receiptId),
    // 2. line_items for this receipt — now childless with respect to
    // review_queue.
    db.prepare(`DELETE FROM line_items WHERE receipt_id = ?`).bind(receiptId),
    // 3. receipt_sources join rows — the source rows themselves are never
    // touched (see module doc above).
    db.prepare(`DELETE FROM receipt_sources WHERE receipt_id = ?`).bind(receiptId),
    // 4. The receipt itself — now childless with respect to line_items and
    // receipt_sources, so this no longer collides with ON DELETE RESTRICT.
    db.prepare(`DELETE FROM receipts WHERE id = ?`).bind(receiptId),
  ];
}

export interface DeleteReceiptResult {
  /** `false` when the receipt was already gone — idempotent, no throw. */
  deleted: boolean;
  lineItemsDeleted: number;
  reviewQueueRowsDeleted: number;
  sourceLinksDeleted: number;
  /** The receipt's stored `r2_key`, or `null` if it never had one (an
   * email-only receipt). Still populated even when `r2Deleted` is `false`
   * so a caller can retry the R2 delete against the same key. */
  r2Key: string | null;
  /** `true` only when an R2 object actually existed at `r2Key` and the
   * delete call for it completed. `false` when `r2Key` was `null` — there
   * was nothing to delete, not a failure. */
  r2Deleted: boolean;
}

interface ReceiptRow {
  id: string;
  r2_key: string | null;
}

/**
 * Deletes a receipt and everything the FK graph makes child to it —
 * review-queue rows (including resolved verdicts), line items, and
 * receipt-source links — as one atomic `db.batch()`, then deletes its R2
 * image if it had one. Never touches `golden_set` or `sources` (see module
 * doc). Idempotent: calling this on an id that is already gone (or never
 * existed) returns `{ deleted: false, ... }` unchanged rather than
 * throwing.
 */
export async function deleteReceipt(
  db: D1Database,
  r2: R2Bucket,
  receiptId: string,
): Promise<DeleteReceiptResult> {
  const row = await db
    .prepare(`SELECT id, r2_key FROM receipts WHERE id = ?`)
    .bind(receiptId)
    .first<ReceiptRow>();

  if (!row) {
    return {
      deleted: false,
      lineItemsDeleted: 0,
      reviewQueueRowsDeleted: 0,
      sourceLinksDeleted: 0,
      r2Key: null,
      r2Deleted: false,
    };
  }

  // D1 batch first — atomic across all four statements, and RESTRICT
  // still fires if the order above is ever wrong (see delete.test.ts's
  // reversed-order proof). Only once this commits does the R2 delete run
  // — see the module doc's "R2 ordering" paragraph for why that order,
  // not the reverse, is deliberate.
  const batchResults = await db.batch(deleteReceiptStatements(db, receiptId));
  const [reviewQueueResult, lineItemsResult, sourceLinksResult] = batchResults;
  if (!reviewQueueResult || !lineItemsResult || !sourceLinksResult) {
    // db.batch() is documented to return one result per statement, in
    // order — this would mean the D1 binding violated that contract.
    // noUncheckedIndexedAccess requires this check; it is not expected to
    // ever actually throw.
    throw new Error(
      `deleteReceipt: db.batch() returned ${batchResults.length} results for receipt ${receiptId}, expected 4`,
    );
  }

  const r2Key = row.r2_key;
  let r2Deleted = false;
  if (r2Key !== null) {
    // Deliberately not wrapped in a try/catch that would report success
    // regardless — see the module doc's "R2 ordering" paragraph. A
    // failure here rejects this promise (the D1 side has already
    // committed) rather than silently lying that the image is gone.
    await r2.delete(r2Key);
    r2Deleted = true;
  }

  return {
    deleted: true,
    reviewQueueRowsDeleted: reviewQueueResult.meta.changes,
    lineItemsDeleted: lineItemsResult.meta.changes,
    sourceLinksDeleted: sourceLinksResult.meta.changes,
    r2Key,
    r2Deleted,
  };
}
