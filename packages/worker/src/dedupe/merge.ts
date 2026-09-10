/**
 * Dedupe — photo/email merge, D1-backed half (STON-11).
 *
 * `packages/core/src/dedupe.ts` is the pure rule with zero database
 * knowledge; this module is what actually reads and writes D1 against it:
 * `findMergeCandidates` runs the narrowing SQL query, and `linkOrMerge` is
 * the single entry point a future extraction-persist step calls (STON-5
 * photo, STON-6 email — neither exists yet; see the module-level note at
 * the bottom of this file and the PR description for why there is no call
 * site in this ticket).
 *
 * The photo path creates a `receipts` row at upload, before merchant/date/
 * total are known (they arrive only once extraction completes) — so by the
 * time `linkOrMerge` is called, its caller has already `UPDATE`d that row
 * with the extraction result. `linkOrMerge` reads the row back rather than
 * trusting a second, possibly-stale copy of those fields passed in.
 */

import {
  DEDUPE_DATE_WINDOW_DAYS,
  type DedupeCandidate,
  nowIso,
  resolveDedupe,
  type SourceType,
  shiftDay,
} from "@stonesoup/core";

export interface MergeCandidateKey {
  purchasedAt: string;
  totalCents: number;
  excludeReceiptId: string;
  windowDays?: number;
}

interface CandidateRow {
  id: string;
  created_at: string;
  merchant_normalized: string | null;
  purchased_at: string | null;
  total_cents: number | null;
  payment_last4: string | null;
  source_types: string | null;
  line_item_count: number;
}

/**
 * Narrows on the half-open purchase-day range and exact total, then leaves
 * the merchant-token comparison and the shape-aware date exactness to
 * `matchDecision`/`resolveDedupe` in TS (`packages/core/src/dedupe.ts`) —
 * this query cannot know a candidate's `purchased_at` shape ahead of time,
 * so its range is widened by `windowDays` on both sides of the incoming
 * day to guarantee no legitimate asymmetric-shape match falls outside it;
 * `resolveDedupe` then applies the real (narrower, shape-aware) rule to
 * whatever this over-fetches. `merchant_normalized` is compared here only
 * as `IS NOT NULL` — the token fold that actually matches it never happens
 * in SQL.
 *
 * `total_cents` is compared exactly, not the checksum tolerance — see
 * `packages/core/src/dedupe.ts`'s module comment.
 *
 * `source_types` is `NULL` (mapped to `[]` below) when the candidate has
 * no `receipt_sources` rows at all — that is UNKNOWN provenance, and
 * `matchDecision` (`packages/core/src/dedupe.ts`) is the layer that
 * refuses to treat an empty list as "different" from the incoming source
 * type (review round 1, finding 1). This query only produces the raw
 * list; it does not interpret it.
 *
 * `line_item_count` is a second `LEFT JOIN` + `COUNT(DISTINCT ...)` in the
 * same grouped query, not a second round trip — `selectSurvivor` needs to
 * know, for every candidate, whether it already carries committed line
 * items so it can prefer that side as the merge survivor (review round 1,
 * finding 3).
 */
export async function findMergeCandidates(
  db: D1Database,
  key: MergeCandidateKey,
): Promise<DedupeCandidate[]> {
  const windowDays = key.windowDays ?? DEDUPE_DATE_WINDOW_DAYS;
  const day = key.purchasedAt.slice(0, 10);
  const lowerBound = shiftDay(day, -windowDays);
  const upperBoundExclusive = shiftDay(day, windowDays + 1);

  const { results } = await db
    .prepare(
      `SELECT r.id, r.created_at, r.merchant_normalized, r.purchased_at, r.total_cents, r.payment_last4,
              GROUP_CONCAT(DISTINCT s.type) AS source_types,
              COUNT(DISTINCT li.id) AS line_item_count
         FROM receipts r
         LEFT JOIN receipt_sources rs ON rs.receipt_id = r.id
         LEFT JOIN sources s ON s.id = rs.source_id
         LEFT JOIN line_items li ON li.receipt_id = r.id
        WHERE r.purchased_at >= ?1 AND r.purchased_at < ?2
          AND r.total_cents = ?3
          AND r.merchant_normalized IS NOT NULL
          AND r.id != ?4
        GROUP BY r.id`,
    )
    .bind(lowerBound, upperBoundExclusive, key.totalCents, key.excludeReceiptId)
    .all<CandidateRow>();

  return results.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    merchantNormalized: row.merchant_normalized,
    purchasedAt: row.purchased_at,
    totalCents: row.total_cents,
    paymentLast4: row.payment_last4,
    sourceTypes: (row.source_types ? row.source_types.split(",") : []) as SourceType[],
    hasLineItems: row.line_item_count > 0,
  }));
}

export interface LinkOrMergeInput {
  /** The `receipts.id` already written to D1 for this extraction. Its key
   * fields (merchant_normalized, purchased_at, total_cents, ...) must
   * already be `UPDATE`d with the extraction result before calling this —
   * `linkOrMerge` reads them back from the row rather than trusting a
   * second copy. */
  receiptId: string;
  sourceId: string;
  sourceType: SourceType;
  /** Gmail message ID (or equivalent); `null` for the photo path.
   *
   * PRECONDITION (caller's responsibility): this must not already be bound
   * — via an existing `receipt_sources` row — to a receipt other than
   * `receiptId`, unless the caller genuinely intends to move that link.
   * `ensureSourceLinkStatement`'s `ON CONFLICT (external_id) ... DO UPDATE`
   * re-points the existing row silently, on both the no-merge path and
   * inside the merge batch: no error, `merged: false`,
   * `refusedReason: null`. If that row was the other receipt's *only*
   * `receipt_sources` link, that receipt is left with zero — and the
   * unknown-provenance veto (`packages/core/src/dedupe.ts`) then refuses
   * it as a merge candidate from then on, permanently. Not reachable in
   * this ticket (no caller exists yet); STON-6, which will be the first
   * real caller passing a non-null `externalId`, must guarantee this
   * precondition itself (e.g. resolve its own idempotency lookup to the
   * same `receiptId` before calling `linkOrMerge`) rather than discover it
   * the hard way. */
  externalId: string | null;
}

export interface LinkOrMergeResult {
  /** The receipt id line items should be written against — the survivor's
   * id when a merge happened, otherwise `receiptId` unchanged. */
  finalReceiptId: string;
  merged: boolean;
  /** `true` when `finalReceiptId` already has committed line items — the
   * caller must NOT write the incoming extraction's line items in that
   * case (they were only ever in memory; nothing committed is discarded). */
  lineItemsAlreadyPresent: boolean;
  /** Populated (non-null) when the candidate query found two or more
   * matches — ambiguous, so no merge happened and every candidate
   * (including `receiptId`) is left standing. */
  ambiguousMatchCount: number | null;
  /** Populated when a merge was skipped because it would have required
   * deleting a duplicate that already carries committed line items — the
   * dedupe path never deletes a `line_items` row, and never deletes a
   * receipt that has any (AGENTS.md, "Line items are written exactly
   * once"). */
  refusedReason: "duplicate-has-line-items" | null;
}

interface ReceiptRow {
  id: string;
  created_at: string;
  merchant_raw: string;
  merchant_normalized: string | null;
  store_location: string | null;
  purchased_at: string | null;
  subtotal_cents: number | null;
  tax_cents: number | null;
  total_cents: number | null;
  payment_last4: string | null;
  r2_key: string | null;
}

async function lineItemCount(db: D1Database, receiptId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) as c FROM line_items WHERE receipt_id = ?`)
    .bind(receiptId)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

/**
 * Links the incoming source to `receiptId` idempotently. Two shapes,
 * matching the plan:
 *   - `external_id` present (email): `ON CONFLICT (external_id) ...
 *     DO UPDATE` re-points a Gmail re-sync's row instead of erroring on
 *     the unique index — never the banned REPLACE-based upsert (AGENTS.md,
 *     Data conventions #8).
 *   - `external_id` NULL (photo): the partial unique index never applies,
 *     so an `INSERT ... SELECT ... WHERE NOT EXISTS (...)` guard is used
 *     instead of anything REPLACE-shaped.
 */
function ensureSourceLinkStatement(
  db: D1Database,
  args: { receiptId: string; sourceId: string; externalId: string | null },
): D1PreparedStatement {
  const id = crypto.randomUUID();
  const ingestedAt = nowIso();
  if (args.externalId !== null) {
    return db
      .prepare(
        `INSERT INTO receipt_sources (id, receipt_id, source_id, external_id, ingested_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (external_id) WHERE external_id IS NOT NULL
         DO UPDATE SET receipt_id = excluded.receipt_id, ingested_at = excluded.ingested_at`,
      )
      .bind(id, args.receiptId, args.sourceId, args.externalId, ingestedAt);
  }
  return db
    .prepare(
      `INSERT INTO receipt_sources (id, receipt_id, source_id, external_id, ingested_at)
       SELECT ?, ?, ?, NULL, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM receipt_sources WHERE receipt_id = ? AND source_id = ? AND external_id IS NULL
        )`,
    )
    .bind(id, args.receiptId, args.sourceId, ingestedAt, args.receiptId, args.sourceId);
}

/**
 * The single dedupe entry point. Later epics (STON-5 photo, STON-6 email)
 * call this from their extraction-persist step rather than reinventing it.
 *
 * No merge, or an ambiguous/refused one, always still links the incoming
 * source to its own `receiptId` — a receipt that doesn't merge is not
 * abandoned, it just stays a standing receipt with its own source link,
 * same as if dedupe didn't exist.
 */
export async function linkOrMerge(
  db: D1Database,
  input: LinkOrMergeInput,
): Promise<LinkOrMergeResult> {
  const incomingRow = await db
    .prepare(`SELECT * FROM receipts WHERE id = ?`)
    .bind(input.receiptId)
    .first<ReceiptRow>();
  if (!incomingRow) {
    throw new Error(`linkOrMerge: receipts row ${input.receiptId} does not exist`);
  }

  const noMerge = async (
    extra: Partial<Pick<LinkOrMergeResult, "ambiguousMatchCount" | "refusedReason">> = {},
  ): Promise<LinkOrMergeResult> => {
    await ensureSourceLinkStatement(db, {
      receiptId: input.receiptId,
      sourceId: input.sourceId,
      externalId: input.externalId,
    }).run();
    return {
      finalReceiptId: input.receiptId,
      merged: false,
      lineItemsAlreadyPresent: (await lineItemCount(db, input.receiptId)) > 0,
      ambiguousMatchCount: extra.ambiguousMatchCount ?? null,
      refusedReason: extra.refusedReason ?? null,
    };
  };

  // Requiring all three key fields non-NULL is, in effect, the status
  // gate: a pending/extracting/failed receipt has nothing to match on and
  // is never a merge candidate (no coupling to receipts.status is added).
  if (
    incomingRow.merchant_normalized === null ||
    incomingRow.purchased_at === null ||
    incomingRow.total_cents === null
  ) {
    return noMerge();
  }

  const candidates = await findMergeCandidates(db, {
    purchasedAt: incomingRow.purchased_at,
    totalCents: incomingRow.total_cents,
    excludeReceiptId: input.receiptId,
  });

  // Almost always false for a freshly-extracted receipt being persisted
  // for the first time, but computed rather than assumed — a
  // re-extraction/backfill call could differ, and selectSurvivor's
  // line-items preference (review round 1, finding 3) needs the real
  // answer for both sides, not just the candidate side.
  const incomingHasLineItems = (await lineItemCount(db, incomingRow.id)) > 0;

  const resolution = resolveDedupe(
    {
      id: incomingRow.id,
      createdAt: incomingRow.created_at,
      merchantNormalized: incomingRow.merchant_normalized,
      purchasedAt: incomingRow.purchased_at,
      totalCents: incomingRow.total_cents,
      paymentLast4: incomingRow.payment_last4,
      sourceType: input.sourceType,
      hasLineItems: incomingHasLineItems,
    },
    candidates,
  );

  if (resolution.outcome === "no-match") {
    return noMerge();
  }

  if (resolution.outcome === "ambiguous") {
    return noMerge({ ambiguousMatchCount: resolution.matchCount });
  }

  const { survivor, duplicate } = resolution;

  // The dedupe path never deletes a line_items row, and never deletes a
  // receipt that has any. If the duplicate somehow already carries line
  // items (a re-extraction, a backfill), refuse and leave both receipts
  // standing rather than attempt a merge the schema's ON DELETE RESTRICT
  // would only reject anyway.
  const duplicateLineItems = await lineItemCount(db, duplicate.id);
  if (duplicateLineItems > 0) {
    return noMerge({ refusedReason: "duplicate-has-line-items" });
  }

  const duplicateRow =
    duplicate.id === incomingRow.id
      ? incomingRow
      : await db
          .prepare(`SELECT * FROM receipts WHERE id = ?`)
          .bind(duplicate.id)
          .first<ReceiptRow>();
  if (!duplicateRow) {
    throw new Error(`linkOrMerge: duplicate receipts row ${duplicate.id} vanished mid-merge`);
  }

  const now = nowIso();

  // Ordered statements, issued as one db.batch() — atomic; D1 has no
  // interactive transactions. Order matters: re-point receipt_sources
  // (1) before deleting the duplicate (4), never the reverse — ON DELETE
  // RESTRICT on receipt_sources.receipt_id is the backstop if this order
  // is ever gotten wrong (see merge.test.ts's ordering-proof test).
  const statements: D1PreparedStatement[] = [
    // 1. Re-point every receipt_sources row from the duplicate to the
    // survivor. No ON CONFLICT needed: there is no unique constraint on
    // (receipt_id, source_id), and external_id's unique index is global,
    // so re-pointing cannot collide.
    db
      .prepare(`UPDATE receipt_sources SET receipt_id = ? WHERE receipt_id = ?`)
      .bind(survivor.id, duplicate.id),
    // 2. Link the incoming source to the survivor.
    ensureSourceLinkStatement(db, {
      receiptId: survivor.id,
      sourceId: input.sourceId,
      externalId: input.externalId,
    }),
    // 3. Fill only NULL columns on the survivor from the duplicate's
    // values. merchant_raw is deliberately NOT in this SET list — the
    // BEFORE UPDATE OF merchant_raw trigger only fires when the column is
    // named, and the survivor's own merchant_raw is its own source's
    // evidence, never overwritten by the losing side's.
    db
      .prepare(
        `UPDATE receipts SET
           store_location = COALESCE(store_location, ?),
           payment_last4 = COALESCE(payment_last4, ?),
           subtotal_cents = COALESCE(subtotal_cents, ?),
           tax_cents = COALESCE(tax_cents, ?),
           r2_key = COALESCE(r2_key, ?),
           purchased_at = COALESCE(purchased_at, ?),
           merchant_normalized = COALESCE(merchant_normalized, ?),
           updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        duplicateRow.store_location,
        duplicateRow.payment_last4,
        duplicateRow.subtotal_cents,
        duplicateRow.tax_cents,
        duplicateRow.r2_key,
        duplicateRow.purchased_at,
        duplicateRow.merchant_normalized,
        now,
        survivor.id,
      ),
    // 4. Delete the now-childless duplicate. Deliberately unguarded — no
    // `NOT EXISTS (SELECT 1 FROM line_items ...)` here (review round 1,
    // finding 2). The upfront duplicateLineItems check above (line ~291)
    // is a TOCTOU-vulnerable optimistic check: a line item can land on
    // the duplicate between that check and this batch (queue redelivery,
    // a concurrent extraction). A `NOT EXISTS`-guarded DELETE would match
    // 0 rows in that race and succeed silently — the batch would not
    // throw, statements 1-3 would still commit, and the caller would be
    // told `merged: true` while the duplicate survives holding its line
    // items with zero receipt_sources rows: a silent partial merge and a
    // double-count. An unguarded DELETE instead collides with
    // `ON DELETE RESTRICT` on line_items.receipt_id and lets D1 abort the
    // *entire* batch atomically — the loud failure the comment on
    // statements 1-3 already assumes is happening. Let the schema do its
    // job; do not re-add a guard here.
    db.prepare(`DELETE FROM receipts WHERE id = ?`).bind(duplicate.id),
  ];

  await db.batch(statements);

  return {
    finalReceiptId: survivor.id,
    merged: true,
    lineItemsAlreadyPresent: (await lineItemCount(db, survivor.id)) > 0,
    ambiguousMatchCount: null,
    refusedReason: null,
  };
}

// The extraction-persist call site does not exist yet: `packages/worker/
// src/index.ts`'s `queue()` is an empty seam awaiting STON-5 (photo) /
// STON-6 (email). This ticket ships the rule and this primitive only —
// wiring `linkOrMerge` into the real persist path belongs to those
// tickets, not this one (STON-11's plan, "Files" section).
