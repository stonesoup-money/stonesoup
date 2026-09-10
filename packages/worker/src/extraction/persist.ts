/**
 * `persistExtraction` — writes an already-parsed extraction result to D1.
 * Ordering matters and is not a single batch (AGENTS.md; STON-11's
 * `linkOrMerge` contract):
 *
 *   1. One `db.batch()`: the receipts UPDATE. `merchant_raw` is named
 *      here exactly once in this row's life — migration `0002`'s
 *      write-once-from-NULL guard fires on any later UPDATE naming it.
 *   2. `linkOrMerge(...)` — must run *before* line items are written:
 *      `LinkOrMergeResult.lineItemsAlreadyPresent` and `selectSurvivor`
 *      only work if the merge runs first (`packages/worker/src/dedupe/merge.ts`).
 *   3. If `!lineItemsAlreadyPresent`, one more `db.batch()` writing line
 *      items (deterministic id `${receiptId}:${lineNumber}`) and their
 *      `review_queue` rows (`${lineItemId}:1`), both `ON CONFLICT (id) DO
 *      NOTHING` — never the banned REPLACE-based upsert, and `DO NOTHING`
 *      avoids tripping `line_items_raw_text_immutable` on a queue retry
 *      that returns slightly different text.
 *
 * `ON DELETE RESTRICT` forces this ordering discipline throughout: every
 * FK in `0001`/`0002` is RESTRICT, not CASCADE, so a write path here must
 * respect children-before-parents rather than relying on a schema-level
 * cascade to clean up after a wrong order.
 */

import {
  CONFIDENCE_FLOOR_DEFAULT,
  type ExtractionResult,
  evaluateChecksum,
  nowIso,
  routingReason,
  type SourceType,
} from "@stonesoup/core";
import { linkOrMerge } from "../dedupe/merge.js";

export interface PersistExtractionEnv {
  DB: D1Database;
  CONFIDENCE_FLOOR?: string;
}

export interface PersistExtractionArgs {
  receiptId: string;
  userId: string;
  sourceType: SourceType;
  result: ExtractionResult;
  extractionModel: string;
  inputTokens: number;
  outputTokens: number;
}

export interface PersistExtractionResult {
  finalReceiptId: string;
  checksumResult: "pass" | "fail" | "not_run";
  merged: boolean;
  lineItemsWritten: number;
}

export async function persistExtraction(
  env: PersistExtractionEnv,
  args: PersistExtractionArgs,
): Promise<PersistExtractionResult> {
  const db = env.DB;
  const { result } = args;
  const now = nowIso();

  const checksum = evaluateChecksum({
    lineItemCents: result.line_items.map((item) => item.extended_price_cents ?? 0),
    taxCents: result.tax_cents,
    statedTotalCents: result.total_cents,
  });
  // A checksum failure routes the whole receipt (STON-7's plan depends on
  // this staying exactly as written); a pass moves it straight to
  // 'extracted'.
  const status = checksum.result === "fail" ? "needs_review" : "extracted";

  // 1. The extraction UPDATE — the one place merchant_raw is named in this
  // row's life.
  await db.batch([
    db
      .prepare(
        `UPDATE receipts SET
           merchant_raw = ?, merchant_normalized = ?, store_location = ?, purchased_at = ?,
           subtotal_cents = ?, tax_cents = ?, total_cents = ?, payment_last4 = ?,
           checksum_result = ?, checksum_delta_cents = ?, status = ?,
           extraction_model = ?, extraction_input_tokens = ?, extraction_output_tokens = ?,
           extracted_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        result.merchant_raw,
        result.merchant_normalized,
        result.store_location,
        result.purchased_at,
        result.subtotal_cents,
        result.tax_cents,
        result.total_cents,
        result.payment_last4,
        checksum.result,
        checksum.deltaCents,
        status,
        args.extractionModel,
        args.inputTokens,
        args.outputTokens,
        now,
        now,
        args.receiptId,
      ),
  ]);

  // 2. linkOrMerge — before any line item is written (see module doc).
  const sourceId = `${args.sourceType}:${args.userId}`;
  const linkResult = await linkOrMerge(db, {
    receiptId: args.receiptId,
    sourceId,
    sourceType: args.sourceType,
    externalId: null,
  });

  if (linkResult.refusedReason === "external-id-bound-to-other-receipt") {
    // Unreachable on this ticket's photo path — externalId is always null
    // here, which never takes linkOrMerge's ON CONFLICT (external_id)
    // branch (see merge.ts's own doc comment) — but handled explicitly
    // rather than assumed away (STON-19's own review finding).
    console.error(
      `persistExtraction: unexpected external-id-bound-to-other-receipt refusal for receipt ${args.receiptId}`,
    );
  }

  let lineItemsWritten = 0;
  if (!linkResult.lineItemsAlreadyPresent) {
    const confidenceFloor = Number(env.CONFIDENCE_FLOOR) || CONFIDENCE_FLOOR_DEFAULT;
    const statements: D1PreparedStatement[] = [];

    result.line_items.forEach((item, index) => {
      const lineNumber = index + 1;
      const lineItemId = `${linkResult.finalReceiptId}:${lineNumber}`;

      statements.push(
        db
          .prepare(
            `INSERT INTO line_items (
               id, receipt_id, line_number, raw_text, normalized_name, qty,
               unit_price_cents, extended_price_cents, discount_cents,
               category, subcategory, confidence, taxonomy_version, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (id) DO NOTHING`,
          )
          .bind(
            lineItemId,
            linkResult.finalReceiptId,
            lineNumber,
            item.raw_text,
            item.normalized_name,
            item.qty,
            item.unit_price_cents,
            item.extended_price_cents,
            item.discount_cents,
            item.category,
            item.subcategory,
            item.confidence,
            result.taxonomy_version,
            now,
            now,
          ),
      );

      const reason = routingReason(
        { confidence: item.confidence },
        { receiptChecksumFailed: checksum.result === "fail", confidenceFloor },
      );
      statements.push(
        db
          .prepare(
            `INSERT INTO review_queue (id, line_item_id, reason, created_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (id) DO NOTHING`,
          )
          .bind(`${lineItemId}:1`, lineItemId, reason, now),
      );

      lineItemsWritten++;
    });

    if (statements.length > 0) {
      await db.batch(statements);
    }
  }

  return {
    finalReceiptId: linkResult.finalReceiptId,
    checksumResult: checksum.result,
    merged: linkResult.merged,
    lineItemsWritten,
  };
}
