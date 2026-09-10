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
   * PRECONDITION, now enforced here (STON-19): if this is already bound —
   * via an existing `receipt_sources` row — to a receipt other than
   * `receiptId`, `linkOrMerge` refuses before writing anything, returning
   * `refusedReason: "external-id-bound-to-other-receipt"` with
   * `externalIdBoundTo` naming the holder. It never re-points the row —
   * that would strand the holder's only source link and, via the
   * unknown-provenance veto in `packages/core/src/dedupe.ts`, make it
   * permanently unmergeable. A caller that hits this refusal should
   * resolve its own idempotency lookup against `externalIdBoundTo` and
   * re-drive the call with the matching `receiptId` — the normal Gmail
   * re-sync case (STON-6) always finds `externalIdBoundTo` equal to the
   * `receiptId` it already intended, and falls through unrefused (see
   * merge.test.ts, block K, case 3). */
  externalId: string | null;
}

export interface LinkOrMergeResult {
  /** The receipt id line items should be written against — the survivor's
   * id when a merge happened, otherwise `receiptId` unchanged —
   * **except** when `refusedReason` is
   * `"external-id-bound-to-other-receipt"` (STON-19): `finalReceiptId`
   * there is `input.receiptId`, a receipt this call deliberately left
   * with zero `receipt_sources` rows, and committing line items to it
   * strands it exactly as permanently as the case this ticket fixes (it
   * can never become a merge duplicate once it holds line items, and it
   * can never be a merge candidate with no source link either). Always
   * check `lineItemsAlreadyPresent` before writing — it is forced `true`
   * on that path for exactly this reason — do not gate the write on
   * `finalReceiptId` alone. */
  finalReceiptId: string;
  merged: boolean;
  /** `true` when the caller must NOT write the incoming extraction's line
   * items to `finalReceiptId`. Set when `finalReceiptId` already has
   * committed line items (they were only ever in memory; nothing
   * committed is discarded) — **or** forced `true` on the
   * `"external-id-bound-to-other-receipt"` refusal (STON-19) even though
   * `finalReceiptId` has no committed items yet: writing there would
   * strand it just as permanently. Treat this flag as "do not write
   * here", not as a literal item count. */
  lineItemsAlreadyPresent: boolean;
  /** Populated (non-null) when the candidate query found two or more
   * matches — ambiguous, so no merge happened and every candidate
   * (including `receiptId`) is left standing. */
  ambiguousMatchCount: number | null;
  /** Populated when a merge was skipped because it would have required
   * deleting a duplicate that already carries committed line items — the
   * dedupe path never deletes a `line_items` row, and never deletes a
   * receipt that has any (AGENTS.md, "Line items are written exactly
   * once") — or when the incoming `externalId` is already bound to a
   * different receipt (STON-19), in which case `externalIdBoundTo` names
   * the holder. */
  refusedReason: "duplicate-has-line-items" | "external-id-bound-to-other-receipt" | null;
  /** The `receipts.id` that already holds `input.externalId`'s
   * `receipt_sources` link. Populated only when `refusedReason` is
   * `"external-id-bound-to-other-receipt"`; `null` on every other path,
   * including every success. */
  externalIdBoundTo: string | null;
}

interface ReceiptRow {
  id: string;
  created_at: string;
  merchant_raw: string | null;
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
 *     Data conventions #8). The `DO UPDATE`'s own `WHERE` restricts it to
 *     the case where the conflicting row already belongs to this same
 *     `receiptId` (STON-19): `linkOrMerge`'s guard is the primary defense
 *     against moving another receipt's link, but D1 has no interactive
 *     transactions, so that check-then-write has a race window; this
 *     `WHERE` makes the statement itself structurally incapable of moving
 *     a link regardless — when it doesn't match, the upsert is a silent
 *     no-op (link not made) rather than a steal, at the SQL level. Silent
 *     to this statement, not necessarily to its caller: `writeSourceLink`
 *     below wraps this exact statement and turns that no-op into an
 *     observable outcome for `noMerge()` (review round 2, finding 1) —
 *     `.run()`'s own `meta.changes` already says whether a row moved;
 *     nothing here needs to change for that to be true, only who reads
 *     it. `receipt_id = excluded.receipt_id` in the `SET` list is
 *     consequently always a no-op too; it is kept only so the statement
 *     still reads as an upsert — do not read it as redundant with the
 *     `WHERE` and remove either.
 *   - `external_id` NULL (photo): the partial unique index never applies,
 *     so an `INSERT ... SELECT ... WHERE NOT EXISTS (...)` guard is used
 *     instead of anything REPLACE-shaped.
 *
 * Exported (marked internal) so the race case above can be proven
 * directly against real D1 in merge.test.ts rather than against a copy of
 * this SQL.
 */
export function ensureSourceLinkStatement(
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
         DO UPDATE SET receipt_id = excluded.receipt_id, ingested_at = excluded.ingested_at
           WHERE receipt_sources.receipt_id = excluded.receipt_id`,
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

export interface SourceLinkOutcome {
  /** `false` when the statement's own `WHERE` (see `ensureSourceLinkStatement`)
   * silently blocked the write because, as of this write, `external_id` is
   * already held by some other receipt — the check-then-write race window
   * `linkOrMerge`'s upfront guard cannot close on its own (D1 has no
   * interactive transactions). Always `true` for the `external_id === null`
   * (photo) path — its `WHERE NOT EXISTS` guard only ever no-ops on a
   * genuine duplicate call for the same receipt, never a race with another
   * receipt, so there is nothing to detect there. */
  linked: boolean;
  /** The receipt that holds `externalId` as of this write, when `linked` is
   * `false`. `null` on every other outcome, including every `linked: true`. */
  boundTo: string | null;
}

/**
 * Runs `ensureSourceLinkStatement` and reports whether the write actually
 * landed, rather than trusting that a resolved promise means a row changed
 * (review round 2, finding 1). For the `external_id !== null` branch,
 * `meta.changes === 0` is possible only when the statement's `WHERE` blocked
 * an upsert into a row some other receipt already holds as of this write: a
 * fresh insert always changes exactly one row, and a same-receipt conflict's
 * `DO UPDATE` always changes exactly one row too (SQLite writes the row
 * whether or not the new values differ from the old ones). So `changes === 0`
 * means, unambiguously, "someone else holds it now" — this function re-reads
 * who and reports it, instead of letting the caller read a resolved `.run()`
 * as success.
 *
 * Exported (marked internal) so the race this exists to detect can be proven
 * directly against real D1 in merge.test.ts, the same way
 * `ensureSourceLinkStatement` already proves the statement's `WHERE` cannot
 * move a link — by binding `externalId` to one receipt first and then
 * driving this function for another, rather than needing genuine concurrent
 * callers.
 */
export async function writeSourceLink(
  db: D1Database,
  args: { receiptId: string; sourceId: string; externalId: string | null },
): Promise<SourceLinkOutcome> {
  const result = await ensureSourceLinkStatement(db, args).run();
  if (args.externalId === null || result.meta.changes !== 0) {
    return { linked: true, boundTo: null };
  }
  const holder = await db
    .prepare(`SELECT receipt_id FROM receipt_sources WHERE external_id = ?`)
    .bind(args.externalId)
    .first<{ receipt_id: string }>();
  return { linked: false, boundTo: holder?.receipt_id ?? null };
}

/**
 * The single dedupe entry point. Later epics (STON-5 photo, STON-6 email)
 * call this from their extraction-persist step rather than reinventing it.
 *
 * No merge, or an ambiguous/refused one, always still links the incoming
 * source to its own `receiptId` — a receipt that doesn't merge is not
 * abandoned, it just stays a standing receipt with its own source link,
 * same as if dedupe didn't exist — with exactly one exception (STON-19):
 * a refusal because `externalId` is already bound to a different receipt
 * links nothing, since writing the link is the exact write being refused.
 * The incoming receipt is left with zero `receipt_sources` rows of its
 * own in that case, and so is itself unmergeable (unknown-provenance
 * veto, `packages/core/src/dedupe.ts`) until a caller re-drives the call
 * correctly. That is the accepted trade-off — a visible, recoverable
 * duplicate beats the permanently stranded receipt this ticket exists to
 * prevent — do not "fix" it by linking anyway.
 *
 * That same exception is also reachable without ever hitting the upfront
 * guard below (review round 2, finding 1): the guard's `SELECT` and the
 * no-merge path's write are two round trips with no interactive
 * transaction between them, so a concurrent call can bind `externalId`
 * to a different receipt in the gap. `noMerge()` uses `writeSourceLink`
 * rather than a bare `.run()` specifically so it notices that no-op and
 * returns the identical refusal shape instead of a clean "linked"
 * result — see `noMerge`'s body.
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

  // STON-19 guard: refuse before any write, and before the candidate
  // query, when input.externalId is already bound to a different
  // receipt. Placing this ahead of the candidate query is load-bearing —
  // the steal this guards against exists on both the no-merge path
  // (ensureSourceLinkStatement below) and inside the merge batch
  // (statement 2), so the check must happen before either is reachable.
  // A same-receipt binding is the normal Gmail re-sync and must fall
  // through unrefused (merge.test.ts, block K, case 3).
  if (input.externalId !== null) {
    const existingLink = await db
      .prepare(`SELECT receipt_id FROM receipt_sources WHERE external_id = ?`)
      .bind(input.externalId)
      .first<{ receipt_id: string }>();
    if (existingLink && existingLink.receipt_id !== input.receiptId) {
      return {
        finalReceiptId: input.receiptId,
        merged: false,
        // Forced true (review round 2, finding 1) — not a literal item
        // count. input.receiptId has zero receipt_sources rows on this
        // path (that is the whole refusal), so a caller that writes line
        // items here anyway strands it just as permanently as the
        // duplicate-has-line-items case: it can never be a merge
        // duplicate once it holds committed items, and it can never be a
        // merge candidate with no source link. This flag is the
        // documented "do not write" signal on every path — see
        // LinkOrMergeResult.lineItemsAlreadyPresent and .finalReceiptId.
        lineItemsAlreadyPresent: true,
        ambiguousMatchCount: null,
        refusedReason: "external-id-bound-to-other-receipt",
        externalIdBoundTo: existingLink.receipt_id,
      };
    }
  }

  const noMerge = async (
    // `refusedReason` is narrowed to exclude "external-id-bound-to-other-
    // receipt" (review round 2, finding 2): the plan is explicit that a
    // *caller of* noMerge() must never statically request this refusal,
    // because noMerge()'s whole job is to write the source link — the
    // exact write being refused when the upfront guard already knows
    // about it. This makes that a type error, not just a prose rule; the
    // guard above returns its own result literal instead. It does not
    // stop noMerge() from *discovering*, dynamically, that this same
    // refusal is the right answer after all — see the writeSourceLink
    // check immediately below, which is a distinct case (a race the type
    // system cannot see coming) from the one this parameter type guards
    // against (a call site that already knows).
    extra: Partial<{
      ambiguousMatchCount: LinkOrMergeResult["ambiguousMatchCount"];
      refusedReason: Exclude<
        LinkOrMergeResult["refusedReason"],
        "external-id-bound-to-other-receipt"
      >;
    }> = {},
  ): Promise<LinkOrMergeResult> => {
    const linkOutcome = await writeSourceLink(db, {
      receiptId: input.receiptId,
      sourceId: input.sourceId,
      externalId: input.externalId,
    });

    // Review round 2, finding 1: the upfront guard's SELECT and this
    // write are not atomic, so a concurrent call can have bound
    // `externalId` to a different receipt in between. writeSourceLink's
    // `meta.changes` check (see its own doc comment) is what notices —
    // report the same refusal the upfront guard would have given if it
    // had run a moment later, instead of a clean "linked" result that
    // invites the caller to write line items to a receipt that, despite
    // this call believing otherwise, holds zero receipt_sources rows.
    if (!linkOutcome.linked) {
      return {
        finalReceiptId: input.receiptId,
        merged: false,
        lineItemsAlreadyPresent: true,
        ambiguousMatchCount: null,
        refusedReason: "external-id-bound-to-other-receipt",
        externalIdBoundTo: linkOutcome.boundTo,
      };
    }

    return {
      finalReceiptId: input.receiptId,
      merged: false,
      lineItemsAlreadyPresent: (await lineItemCount(db, input.receiptId)) > 0,
      ambiguousMatchCount: extra.ambiguousMatchCount ?? null,
      refusedReason: extra.refusedReason ?? null,
      externalIdBoundTo: null,
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
    // 2. Link the incoming source to the survivor. This statement has the
    // same race-loss no-op as noMerge()'s (review round 2, finding 1),
    // deliberately left un-instrumented here: unlike the no-merge path,
    // losing this particular write cannot strand anything, because
    // statement 1 has already given survivor.id every receipt_sources row
    // the duplicate held, so the caller's `finalReceiptId` keeps known
    // provenance regardless of whether this insert lands. The only cost
    // of the race here is losing this externalId's re-sync idempotency
    // record on the survivor — a future re-sync will find it still bound
    // to whoever holds it, not to the survivor, which is the accepted,
    // narrower gap; it is not the permanent-stranding class this ticket
    // closes.
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
    externalIdBoundTo: null,
  };
}

// The extraction-persist call site does not exist yet: `packages/worker/
// src/index.ts`'s `queue()` is an empty seam awaiting STON-5 (photo) /
// STON-6 (email). This ticket ships the rule and this primitive only —
// wiring `linkOrMerge` into the real persist path belongs to those
// tickets, not this one (STON-11's plan, "Files" section).
