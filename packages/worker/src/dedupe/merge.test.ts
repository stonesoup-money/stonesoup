import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { linkOrMerge } from "./merge.js";

/**
 * Integration coverage for the D1-backed half of STON-11's dedupe rule —
 * against the real local D1 binding (migrations/0001_initial_schema.sql),
 * never a mocked database (AGENTS.md, Testing). The pure rule's own case
 * table lives in packages/core/src/dedupe.test.ts; this file only proves
 * the ordered db.batch() actually executes against real SQLite/D1
 * semantics — FK enforcement, triggers, and ON CONFLICT included.
 */

const DB = env.DB;

interface ReceiptFixture {
  id?: string;
  merchantRaw: string;
  merchantNormalized?: string | null;
  storeLocation?: string | null;
  purchasedAt?: string | null;
  subtotalCents?: number | null;
  taxCents?: number | null;
  totalCents?: number | null;
  paymentLast4?: string | null;
  r2Key?: string | null;
  createdAt: string;
  updatedAt?: string;
}

async function insertReceipt(f: ReceiptFixture): Promise<string> {
  const id = f.id ?? crypto.randomUUID();
  await DB.prepare(
    `INSERT INTO receipts (
       id, merchant_raw, merchant_normalized, store_location, purchased_at,
       subtotal_cents, tax_cents, total_cents, payment_last4, r2_key,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      f.merchantRaw,
      f.merchantNormalized ?? null,
      f.storeLocation ?? null,
      f.purchasedAt ?? null,
      f.subtotalCents ?? null,
      f.taxCents ?? null,
      f.totalCents ?? null,
      f.paymentLast4 ?? null,
      f.r2Key ?? null,
      f.createdAt,
      f.updatedAt ?? f.createdAt,
    )
    .run();
  return id;
}

async function insertSource(type: "gmail" | "photo"): Promise<string> {
  const id = crypto.randomUUID();
  await DB.prepare(`INSERT INTO sources (id, type, auth_state) VALUES (?, ?, 'not_applicable')`)
    .bind(id, type)
    .run();
  return id;
}

async function linkSourceDirect(
  receiptId: string,
  sourceId: string,
  externalId: string | null = null,
): Promise<string> {
  const id = crypto.randomUUID();
  await DB.prepare(
    `INSERT INTO receipt_sources (id, receipt_id, source_id, external_id) VALUES (?, ?, ?, ?)`,
  )
    .bind(id, receiptId, sourceId, externalId)
    .run();
  return id;
}

async function insertLineItem(receiptId: string, rawText = "SYNTHETIC ITEM"): Promise<string> {
  const id = crypto.randomUUID();
  await DB.prepare(
    `INSERT INTO line_items (id, receipt_id, raw_text, taxonomy_version) VALUES (?, ?, ?, '0.1.0')`,
  )
    .bind(id, receiptId, rawText)
    .run();
  return id;
}

async function countReceipts(ids: string[]): Promise<number> {
  const placeholders = ids.map(() => "?").join(",");
  const row = await DB.prepare(`SELECT COUNT(*) as c FROM receipts WHERE id IN (${placeholders})`)
    .bind(...ids)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

async function countReceiptSources(receiptId: string): Promise<number> {
  const row = await DB.prepare(`SELECT COUNT(*) as c FROM receipt_sources WHERE receipt_id = ?`)
    .bind(receiptId)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

async function countLineItems(receiptId: string): Promise<number> {
  const row = await DB.prepare(`SELECT COUNT(*) as c FROM line_items WHERE receipt_id = ?`)
    .bind(receiptId)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

async function totalLineItemCount(): Promise<number> {
  const row = await DB.prepare(`SELECT COUNT(*) as c FROM line_items`).first<{ c: number }>();
  return row?.c ?? 0;
}

let gmailSourceId: string;
let photoSourceId: string;

beforeEach(async () => {
  gmailSourceId = await insertSource("gmail");
  photoSourceId = await insertSource("photo");
});

// Test A: the happy photo+email merge.
describe("A: photo + email of one synthetic purchase merge into one receipt", () => {
  it("ends with one receipt, two receipt_sources rows, one set of line items, and the duplicate gone", async () => {
    const emailReceiptId = await insertReceipt({
      merchantRaw: "Trader Joe's",
      merchantNormalized: "Trader Joe's",
      purchasedAt: "2026-03-05",
      totalCents: 4_312,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const emailResult = await linkOrMerge(DB, {
      receiptId: emailReceiptId,
      sourceId: gmailSourceId,
      sourceType: "gmail",
      externalId: "gmail-msg-happy-path",
    });
    expect(emailResult).toMatchObject({ merged: false, finalReceiptId: emailReceiptId });
    await insertLineItem(emailReceiptId, "ORG BANANAS 1.24 LB @ .79/LB");

    // The photo path creates its receipts row at upload, before
    // merchant/date/total are known; this insert stands in for that row
    // once extraction has completed and written the key fields onto it.
    const photoReceiptId = await insertReceipt({
      merchantRaw: "TRADER JOE'S #123",
      merchantNormalized: "TRADER JOE'S #123",
      purchasedAt: "2026-03-05",
      totalCents: 4_312,
      createdAt: "2026-01-01T00:00:01.000Z",
    });

    const result = await linkOrMerge(DB, {
      receiptId: photoReceiptId,
      sourceId: photoSourceId,
      sourceType: "photo",
      externalId: null,
    });

    expect(result.merged).toBe(true);
    expect(result.finalReceiptId).toBe(emailReceiptId);
    expect(result.lineItemsAlreadyPresent).toBe(true);
    expect(result.refusedReason).toBeNull();
    expect(result.ambiguousMatchCount).toBeNull();

    expect(await countReceipts([emailReceiptId, photoReceiptId])).toBe(1);
    expect(await countReceiptSources(emailReceiptId)).toBe(2);
    expect(await countLineItems(emailReceiptId)).toBe(1);

    const survivingIds = await DB.prepare(`SELECT id FROM receipts WHERE id IN (?, ?)`)
      .bind(emailReceiptId, photoReceiptId)
      .all<{ id: string }>();
    expect(survivingIds.results.map((r) => r.id)).toEqual([emailReceiptId]);
  });
});

// Test B: the ordering proof — this is why re-point (step 1) must precede
// delete (step 4) inside linkOrMerge's batch, not a call into linkOrMerge
// itself.
describe("B: deleting a duplicate before re-pointing its receipt_sources fails loudly (the ordering proof)", () => {
  it("rejects a DELETE issued before the re-point, and leaves everything intact", async () => {
    const survivorId = await insertReceipt({
      merchantRaw: "Survivor Store",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const duplicateId = await insertReceipt({
      merchantRaw: "Duplicate Store",
      createdAt: "2026-01-01T00:00:01.000Z",
    });
    const linkId = await linkSourceDirect(duplicateId, gmailSourceId, "gmail-msg-ordering-proof");

    // The wrong order: delete first. receipt_sources.receipt_id is
    // ON DELETE RESTRICT, so this must fail instead of silently orphaning
    // (or cascading away) the link — exactly the backstop linkOrMerge's
    // real ordering (re-point, then delete) exists to never need.
    await expect(
      DB.prepare(`DELETE FROM receipts WHERE id = ?`).bind(duplicateId).run(),
    ).rejects.toThrow();

    const stillLinked = await DB.prepare(`SELECT id FROM receipt_sources WHERE id = ?`)
      .bind(linkId)
      .first();
    expect(stillLinked).not.toBeNull();

    const stillThere = await DB.prepare(`SELECT id FROM receipts WHERE id = ?`)
      .bind(duplicateId)
      .first();
    expect(stillThere).not.toBeNull();

    // Re-pointing first (the real order) makes the same delete succeed.
    await DB.prepare(`UPDATE receipt_sources SET receipt_id = ? WHERE receipt_id = ?`)
      .bind(survivorId, duplicateId)
      .run();
    await expect(
      DB.prepare(`DELETE FROM receipts WHERE id = ?`).bind(duplicateId).run(),
    ).resolves.toBeDefined();
  });
});

// Test C: the duplicate-has-line-items refusal.
describe("C: a merge that would require deleting committed line items refuses instead", () => {
  it("refuses, leaves both receipts standing, and deletes nothing", async () => {
    // The incoming row is older, so it would normally be the survivor —
    // but the candidate (younger, and about to become "the duplicate")
    // already carries committed line items from a prior re-extraction or
    // backfill. linkOrMerge must refuse rather than delete real data.
    const incomingReceiptId = await insertReceipt({
      merchantRaw: "Trader Joe's",
      merchantNormalized: "Trader Joe's",
      purchasedAt: "2026-03-15",
      totalCents: 4_312,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const candidateReceiptId = await insertReceipt({
      merchantRaw: "TRADER JOE'S #123",
      merchantNormalized: "TRADER JOE'S #123",
      purchasedAt: "2026-03-15",
      totalCents: 4_312,
      createdAt: "2026-01-01T00:00:01.000Z",
    });
    await insertLineItem(candidateReceiptId, "ALREADY COMMITTED ITEM");

    const result = await linkOrMerge(DB, {
      receiptId: incomingReceiptId,
      sourceId: gmailSourceId,
      sourceType: "gmail",
      externalId: null,
    });

    expect(result.merged).toBe(false);
    expect(result.refusedReason).toBe("duplicate-has-line-items");
    expect(result.finalReceiptId).toBe(incomingReceiptId);

    expect(await countReceipts([incomingReceiptId, candidateReceiptId])).toBe(2);
    expect(await countLineItems(candidateReceiptId)).toBe(1);
  });
});

// Test D: merchant_raw is never touched by the merge's UPDATE.
describe("D: the survivor's merchant_raw is byte-identical after a merge", () => {
  it("preserves the exact printed survivor merchant_raw string", async () => {
    const survivorMerchantRaw = "  Trader  Joe's (Downtown)  ";
    const survivorId = await insertReceipt({
      merchantRaw: survivorMerchantRaw,
      merchantNormalized: "Trader Joe's",
      purchasedAt: "2026-03-25",
      totalCents: 4_312,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const duplicateId = await insertReceipt({
      merchantRaw: "TRADER JOE'S #123",
      merchantNormalized: "TRADER JOE'S #123",
      purchasedAt: "2026-03-25",
      totalCents: 4_312,
      createdAt: "2026-01-01T00:00:01.000Z",
    });

    const result = await linkOrMerge(DB, {
      receiptId: duplicateId,
      sourceId: photoSourceId,
      sourceType: "photo",
      externalId: null,
    });
    expect(result.merged).toBe(true);
    expect(result.finalReceiptId).toBe(survivorId);

    const row = await DB.prepare(`SELECT merchant_raw FROM receipts WHERE id = ?`)
      .bind(survivorId)
      .first<{ merchant_raw: string }>();
    expect(row?.merchant_raw).toBe(survivorMerchantRaw);
  });
});

// Test E: COALESCE fill semantics.
describe("E: COALESCE fill populates only NULL survivor fields and bumps updated_at", () => {
  it("fills NULLs from the duplicate, leaves non-NULL survivor fields untouched", async () => {
    const survivorUpdatedAt = "2026-01-01T00:00:00.000Z";
    const survivorId = await insertReceipt({
      merchantRaw: "Trader Joe's",
      merchantNormalized: "Trader Joe's",
      purchasedAt: "2026-04-05",
      totalCents: 4_312,
      paymentLast4: "1234",
      storeLocation: null,
      subtotalCents: null,
      taxCents: null,
      r2Key: null,
      createdAt: survivorUpdatedAt,
      updatedAt: survivorUpdatedAt,
    });
    const duplicateId = await insertReceipt({
      merchantRaw: "TRADER JOE'S #123",
      merchantNormalized: "TRADER JOE'S #123",
      purchasedAt: "2026-04-05",
      totalCents: 4_312,
      paymentLast4: null,
      storeLocation: "123 Main St, Anytown",
      subtotalCents: 4_000,
      taxCents: 312,
      r2Key: "user-1/2026/03/abc-def",
      createdAt: "2026-01-01T00:00:01.000Z",
    });

    const result = await linkOrMerge(DB, {
      receiptId: duplicateId,
      sourceId: photoSourceId,
      sourceType: "photo",
      externalId: null,
    });
    expect(result.merged).toBe(true);
    expect(result.finalReceiptId).toBe(survivorId);

    const row = await DB.prepare(
      `SELECT store_location, subtotal_cents, tax_cents, r2_key, payment_last4, updated_at
         FROM receipts WHERE id = ?`,
    )
      .bind(survivorId)
      .first<{
        store_location: string;
        subtotal_cents: number;
        tax_cents: number;
        r2_key: string;
        payment_last4: string;
        updated_at: string;
      }>();

    expect(row?.store_location).toBe("123 Main St, Anytown");
    expect(row?.subtotal_cents).toBe(4_000);
    expect(row?.tax_cents).toBe(312);
    expect(row?.r2_key).toBe("user-1/2026/03/abc-def");
    // Non-NULL survivor field is untouched by the duplicate's NULL.
    expect(row?.payment_last4).toBe("1234");
    expect(row?.updated_at).not.toBe(survivorUpdatedAt);
  });
});

// Test F: idempotent re-processing after a merge (Gmail re-sync /
// at-least-once queue redelivery of the same message against the same
// already-persisted receipts row) re-points via ON CONFLICT DO UPDATE
// instead of erroring or duplicating. The external_id unique index is
// what makes the *same message* idempotent (Epic 4's boundary, noted in
// the plan); this proves linkOrMerge's own re-link statement composes
// correctly with it.
describe("F: re-processing the same source after a merge is idempotent", () => {
  it("re-points via ON CONFLICT DO UPDATE with no duplicate row and no error", async () => {
    const emailReceiptId = await insertReceipt({
      merchantRaw: "Trader Joe's",
      merchantNormalized: "Trader Joe's",
      purchasedAt: "2026-04-15",
      totalCents: 4_312,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await linkOrMerge(DB, {
      receiptId: emailReceiptId,
      sourceId: gmailSourceId,
      sourceType: "gmail",
      externalId: "gmail-msg-resync",
    });

    const photoReceiptId = await insertReceipt({
      merchantRaw: "TRADER JOE'S #123",
      merchantNormalized: "TRADER JOE'S #123",
      purchasedAt: "2026-04-15",
      totalCents: 4_312,
      createdAt: "2026-01-01T00:00:01.000Z",
    });
    const mergeResult = await linkOrMerge(DB, {
      receiptId: photoReceiptId,
      sourceId: photoSourceId,
      sourceType: "photo",
      externalId: null,
    });
    expect(mergeResult.merged).toBe(true);
    expect(mergeResult.finalReceiptId).toBe(emailReceiptId);
    expect(await countReceiptSources(emailReceiptId)).toBe(2);

    // Re-sync: extraction-persist runs again for the exact same message
    // against the same receipts row Epic 4's own idempotency lookup would
    // resolve to.
    const resyncResult = await linkOrMerge(DB, {
      receiptId: emailReceiptId,
      sourceId: gmailSourceId,
      sourceType: "gmail",
      externalId: "gmail-msg-resync",
    });

    expect(resyncResult.finalReceiptId).toBe(emailReceiptId);
    // No new row, no duplicate: still exactly the two links from the
    // original merge (gmail + photo).
    expect(await countReceiptSources(emailReceiptId)).toBe(2);

    const externalIdRows = await DB.prepare(
      `SELECT COUNT(*) as c FROM receipt_sources WHERE external_id = ?`,
    )
      .bind("gmail-msg-resync")
      .first<{ c: number }>();
    expect(externalIdRows?.c).toBe(1);
  });
});

// Test G: the merge never touches line_items counts globally, nor
// review_queue / golden_set rows.
describe("G: a merge leaves line_items, review_queue, and golden_set untouched", () => {
  it("does not change the global line_items count and does not touch review_queue/golden_set rows", async () => {
    const survivorId = await insertReceipt({
      merchantRaw: "Trader Joe's",
      merchantNormalized: "Trader Joe's",
      purchasedAt: "2026-04-25",
      totalCents: 4_312,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const lineItemId = await insertLineItem(survivorId, "ORG BANANAS 1.24 LB @ .79/LB");

    const reviewQueueId = crypto.randomUUID();
    await DB.prepare(
      `INSERT INTO review_queue (id, line_item_id, reason, verdict, resolved_at)
       VALUES (?, ?, 'low_confidence', 'corrected', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
    )
      .bind(reviewQueueId, lineItemId)
      .run();

    const goldenSetId = crypto.randomUUID();
    await DB.prepare(
      `INSERT INTO golden_set (id, raw_string, verdict, labeler, taxonomy_version)
       VALUES (?, 'ORG BANANAS 1.24 LB @ .79/LB', 'corrected', 'labeler-1', '0.1.0')`,
    )
      .bind(goldenSetId)
      .run();

    const duplicateId = await insertReceipt({
      merchantRaw: "TRADER JOE'S #123",
      merchantNormalized: "TRADER JOE'S #123",
      purchasedAt: "2026-04-25",
      totalCents: 4_312,
      createdAt: "2026-01-01T00:00:01.000Z",
    });

    const beforeLineItemTotal = await totalLineItemCount();

    const result = await linkOrMerge(DB, {
      receiptId: duplicateId,
      sourceId: photoSourceId,
      sourceType: "photo",
      externalId: null,
    });
    expect(result.merged).toBe(true);

    expect(await totalLineItemCount()).toBe(beforeLineItemTotal);

    const reviewQueueRow = await DB.prepare(`SELECT verdict FROM review_queue WHERE id = ?`)
      .bind(reviewQueueId)
      .first<{ verdict: string }>();
    expect(reviewQueueRow?.verdict).toBe("corrected");

    const goldenSetRow = await DB.prepare(`SELECT raw_string FROM golden_set WHERE id = ?`)
      .bind(goldenSetId)
      .first<{ raw_string: string }>();
    expect(goldenSetRow?.raw_string).toBe("ORG BANANAS 1.24 LB @ .79/LB");
  });
});

describe("no candidates / ambiguous collision (real D1)", () => {
  it("no-match: an unrelated receipt in the window does not merge", async () => {
    await insertReceipt({
      merchantRaw: "Whole Foods",
      merchantNormalized: "Whole Foods",
      purchasedAt: "2026-05-05",
      totalCents: 4_312,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const incomingId = await insertReceipt({
      merchantRaw: "Trader Joe's",
      merchantNormalized: "Trader Joe's",
      purchasedAt: "2026-05-05",
      totalCents: 4_312,
      createdAt: "2026-01-01T00:00:01.000Z",
    });

    const result = await linkOrMerge(DB, {
      receiptId: incomingId,
      sourceId: gmailSourceId,
      sourceType: "gmail",
      externalId: null,
    });
    expect(result.merged).toBe(false);
    expect(result.finalReceiptId).toBe(incomingId);
    expect(await countReceipts([incomingId])).toBe(1);
  });

  it("two-coffees collision: two candidates matching one incoming leaves all three receipts standing", async () => {
    const coffee1 = await insertReceipt({
      merchantRaw: "Blue Bottle Coffee",
      merchantNormalized: "Blue Bottle Coffee",
      purchasedAt: "2026-05-15",
      totalCents: 500,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const coffee2 = await insertReceipt({
      merchantRaw: "Blue Bottle Coffee",
      merchantNormalized: "Blue Bottle Coffee",
      purchasedAt: "2026-05-15",
      totalCents: 500,
      createdAt: "2026-01-01T00:00:01.000Z",
    });
    const incomingId = await insertReceipt({
      merchantRaw: "BLUE BOTTLE COFFEE",
      merchantNormalized: "BLUE BOTTLE COFFEE",
      purchasedAt: "2026-05-15",
      totalCents: 500,
      createdAt: "2026-01-01T00:00:02.000Z",
    });

    const result = await linkOrMerge(DB, {
      receiptId: incomingId,
      sourceId: gmailSourceId,
      sourceType: "gmail",
      externalId: null,
    });

    expect(result.merged).toBe(false);
    expect(result.ambiguousMatchCount).toBe(2);
    expect(result.finalReceiptId).toBe(incomingId);
    // All three receipts survive intact — the rule fails toward a visible
    // duplicate, never toward destroying a real receipt.
    expect(await countReceipts([coffee1, coffee2, incomingId])).toBe(3);
  });
});
