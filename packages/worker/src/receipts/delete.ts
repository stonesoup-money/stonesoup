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
 * the R2 delete fails, leaving an orphaned R2 object — and by then the
 * `receipts` row that held `r2_key` is gone, so that key is the only
 * remaining way to find the object again. `deleteReceipt` captures it
 * before the batch runs (the initial `SELECT`, not a recompute) and hands
 * it back on the result regardless of the R2 outcome. A failed R2 delete
 * is never swallowed into a false success: `deleteReceipt` catches the
 * rejection, reports `r2Deleted: false` with `r2Key` still populated so a
 * caller can retry against the same key, and surfaces the underlying
 * error on `r2Error` rather than letting it disappear. The key convention
 * stays `{userId}/{yyyy}/{mm}/{receiptUuid}` (AGENTS.md, Data conventions
 * #6); this primitive uses `receipts.r2_key` exactly as stored rather
 * than recomputing it.
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
  /** `true` when the delete call for `r2Key` completed without rejecting.
   * R2's `delete()` resolves even when no object exists at the key, so
   * this does not mean an object was actually removed — only that the
   * call finished. `false` when `r2Key` was `null` (nothing to delete,
   * not a failure) or when the delete call rejected — see `r2Error`; in
   * that case `r2Key` stays populated so a caller can retry. */
  r2Deleted: boolean;
  /** The rejection's message when the R2 delete call for `r2Key` failed
   * (transient R2 error, throttle, network). `null` otherwise, including
   * the `r2Key === null` case. By the time this can happen the D1 batch
   * has already committed and the `receipts` row that stored `r2Key` is
   * gone, so `r2Key` on this same result is the only remaining way to
   * retry. */
  r2Error: string | null;
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
      r2Error: null,
    };
  }

  // D1 batch first — atomic across all four statements, and RESTRICT
  // still fires if the order above is ever wrong (see delete.test.ts's
  // reversed-order proof). Only once this commits does the R2 delete run
  // — see the module doc's "R2 ordering" paragraph for why that order,
  // not the reverse, is deliberate.
  const batchResults = await db.batch(deleteReceiptStatements(db, receiptId));
  const [reviewQueueResult, lineItemsResult, sourceLinksResult] = batchResults;
  if (batchResults.length !== 4 || !reviewQueueResult || !lineItemsResult || !sourceLinksResult) {
    // db.batch() is documented to return one result per statement, in
    // order — this would mean the D1 binding violated that contract.
    // noUncheckedIndexedAccess requires the per-element checks; the
    // length check is what actually makes the message's "expected 4"
    // true of the condition. Not expected to ever actually throw.
    throw new Error(
      `deleteReceipt: db.batch() returned ${batchResults.length} results for receipt ${receiptId}, expected 4`,
    );
  }

  const r2Key = row.r2_key;
  let r2Deleted = false;
  let r2Error: string | null = null;
  if (r2Key !== null) {
    // The D1 batch has already committed, so `r2Key` — captured above,
    // before the batch ran — is the only remaining way to find this
    // object again. A rejection here must not throw: it is caught and
    // reported as `r2Deleted: false` with `r2Key` still on the result,
    // never swallowed into a false success. See the module doc's "R2
    // ordering" paragraph.
    try {
      await r2.delete(r2Key);
      r2Deleted = true;
    } catch (err) {
      r2Deleted = false;
      r2Error = err instanceof Error ? err.message : String(err);
      console.error(
        `deleteReceipt: R2 delete failed for key ${r2Key} (receipt ${receiptId} already removed from D1)`,
        err,
      );
    }
  }

  return {
    deleted: true,
    reviewQueueRowsDeleted: reviewQueueResult.meta.changes,
    lineItemsDeleted: lineItemsResult.meta.changes,
    sourceLinksDeleted: sourceLinksResult.meta.changes,
    r2Key,
    r2Deleted,
    r2Error,
  };
}
