import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { ensureSourceLinkStatement, linkOrMerge, writeSourceLink } from "./merge.js";

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

// Test A: the happy photo+email merge, in the REAL ordering (review round
// 1, finding 3). The photo receipts row is created at upload — before
// merchant/date/total are known, so it is always the older row — and the
// email is persisted with committed line items well before the photo's
// asynchronous extraction finishes. An earlier version of this test had
// the ordering backwards (email row created first) and so could not catch
// selectSurvivor picking purely on created_at: in the real ordering that
// bug makes the (line-item-bearing) email the "duplicate" and the merge
// always refuses — the feature silently never fires in its own primary
// flow. See the "inverse ordering" describe block below for the other
// ordering, kept as separate coverage.
describe("A: photo + email of one synthetic purchase merge into one receipt (real ordering: photo row created first)", () => {
  it("ends with one receipt, two receipt_sources rows, one set of line items, and the duplicate gone", async () => {
    // 10:00 — photo upload creates its receipts row before extraction has
    // run: merchant/date/total are still unknown.
    const photoReceiptId = await insertReceipt({
      merchantRaw: "TRADER JOE'S #123",
      createdAt: "2026-06-05T10:00:00.000Z",
    });

    // 10:05 — the email arrives, is extracted synchronously, and is
    // persisted (linkOrMerge finds no candidate yet — the photo row has
    // no merchant_normalized — then the caller writes its line items).
    const emailReceiptId = await insertReceipt({
      merchantRaw: "Trader Joe's",
      merchantNormalized: "Trader Joe's",
      purchasedAt: "2026-06-05",
      totalCents: 4_312,
      createdAt: "2026-06-05T10:05:00.000Z",
    });
    const emailResult = await linkOrMerge(DB, {
      receiptId: emailReceiptId,
      sourceId: gmailSourceId,
      sourceType: "gmail",
      externalId: "gmail-msg-happy-path",
    });
    expect(emailResult).toMatchObject({ merged: false, finalReceiptId: emailReceiptId });
    await insertLineItem(emailReceiptId, "ORG BANANAS 1.24 LB @ .79/LB");

    // 10:30 — the photo's extraction completes. Its caller has already
    // UPDATEd the row's key fields (per linkOrMerge's module contract)
    // before calling linkOrMerge.
    await DB.prepare(
      `UPDATE receipts SET merchant_normalized = ?, purchased_at = ?, total_cents = ? WHERE id = ?`,
    )
      .bind("TRADER JOE'S #123", "2026-06-05", 4_312, photoReceiptId)
      .run();

    const result = await linkOrMerge(DB, {
      receiptId: photoReceiptId,
      sourceId: photoSourceId,
      sourceType: "photo",
      externalId: null,
    });

    // The photo row is the older row (created at 10:00, vs. the email's
    // 10:05) — a created_at-only selectSurvivor would pick it as survivor
    // and refuse to delete the line-item-bearing email as "duplicate".
    // The email must win as survivor because it already carries the
    // committed line items.
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

// Test A2: the inverse ordering — the email row happens to be created
// first, before the photo row. Not the real flow (kept as separate
// coverage per review round 1, finding 3), but it must still merge
// correctly: the line-items preference picks the same survivor regardless
// of which side created_at favors.
describe("A2: photo + email merge — inverse ordering (email row created first)", () => {
  it("still merges onto the line-item-bearing email receipt", async () => {
    const emailReceiptId = await insertReceipt({
      merchantRaw: "Trader Joe's",
      merchantNormalized: "Trader Joe's",
      purchasedAt: "2026-06-10",
      totalCents: 4_312,
      createdAt: "2026-06-10T09:00:00.000Z",
    });
    const emailResult = await linkOrMerge(DB, {
      receiptId: emailReceiptId,
      sourceId: gmailSourceId,
      sourceType: "gmail",
      externalId: "gmail-msg-inverse-ordering",
    });
    expect(emailResult).toMatchObject({ merged: false, finalReceiptId: emailReceiptId });
    await insertLineItem(emailReceiptId, "ORG BANANAS 1.24 LB @ .79/LB");

    // The photo row is created and its extraction result written after
    // the email, so it is the newer row this time.
    const photoReceiptId = await insertReceipt({
      merchantRaw: "TRADER JOE'S #123",
      merchantNormalized: "TRADER JOE'S #123",
      purchasedAt: "2026-06-10",
      totalCents: 4_312,
      createdAt: "2026-06-10T09:30:00.000Z",
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
    expect(await countReceipts([emailReceiptId, photoReceiptId])).toBe(1);
    expect(await countReceiptSources(emailReceiptId)).toBe(2);
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

// Test C: the duplicate-has-line-items refusal. With the line-items-first
// survivor preference (review round 1, finding 3), the item-bearing side
// always wins survivor selection when only one side has committed items —
// see Test A — so this refusal can now only be reached when BOTH sides
// already carry committed line items: whichever one selectSurvivor's
// created_at tiebreak names "duplicate" still has real data that must not
// be deleted. A single re-extraction or backfill producing committed
// items on both sides of a would-be merge is exactly that anomaly.
describe("C: a merge where both sides already carry committed line items refuses instead", () => {
  it("refuses, leaves both receipts standing, and deletes nothing", async () => {
    const incomingReceiptId = await insertReceipt({
      merchantRaw: "Trader Joe's",
      merchantNormalized: "Trader Joe's",
      purchasedAt: "2026-03-15",
      totalCents: 4_312,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await insertLineItem(incomingReceiptId, "ALSO ALREADY COMMITTED ITEM");
    const candidateReceiptId = await insertReceipt({
      merchantRaw: "TRADER JOE'S #123",
      merchantNormalized: "TRADER JOE'S #123",
      purchasedAt: "2026-03-15",
      totalCents: 4_312,
      createdAt: "2026-01-01T00:00:01.000Z",
    });
    // Known provenance — see Test D's comment; a photo link so it doesn't
    // also trip the (separate) same-source-type veto against the
    // incoming gmail source below.
    await linkSourceDirect(candidateReceiptId, photoSourceId);
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
    expect(await countLineItems(incomingReceiptId)).toBe(1);
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
    // Known provenance: the survivor has already been through its own
    // persist step's linkOrMerge call (or, as here, the equivalent direct
    // link), so it has a receipt_sources row — otherwise it would read as
    // unknown provenance and never match at all (review round 1, finding
    // 1; see the dedicated "H" test below for that case).
    await linkSourceDirect(survivorId, gmailSourceId);
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
    // Known provenance — see Test D's comment.
    await linkSourceDirect(survivorId, gmailSourceId);
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
    // Known provenance — see Test D's comment.
    await linkSourceDirect(survivorId, gmailSourceId);
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
    // Known provenance for both candidates — see Test D's comment. A
    // photo link so this test's ambiguity is the collision the test
    // targets, not the (separate) unknown-provenance veto covered by
    // Test H below.
    await linkSourceDirect(coffee1, photoSourceId);
    const coffee2 = await insertReceipt({
      merchantRaw: "Blue Bottle Coffee",
      merchantNormalized: "Blue Bottle Coffee",
      purchasedAt: "2026-05-15",
      totalCents: 500,
      createdAt: "2026-01-01T00:00:01.000Z",
    });
    await linkSourceDirect(coffee2, photoSourceId);
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

// Test H: unknown provenance never merges (review round 1, finding 1). This
// is the exact catastrophic reproduction from the review: two genuinely
// distinct, same-shop, same-day, same-total purchases must not merge just
// because the earlier one has not (yet, or ever) gotten its own
// receipt_sources row written — that is UNKNOWN provenance, not proof the
// two purchases differ.
describe("H: a candidate with no receipt_sources rows never merges (unknown, not different, provenance)", () => {
  it("two same-shop, same-day, same-total coffees stay two receipts when the earlier one has no source link yet", async () => {
    // coffee1 stands in for a receipt whose key fields were written by an
    // extraction-persist step that never reached its own linkOrMerge call
    // (queue retry, a thrown batch) — or a backfill/import path that never
    // wrote a receipt_sources row at all. It is deliberately NOT linked to
    // any source here.
    const coffee1 = await insertReceipt({
      merchantRaw: "Blue Bottle Coffee",
      merchantNormalized: "Blue Bottle Coffee",
      purchasedAt: "2026-06-15",
      totalCents: 500,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const coffee2 = await insertReceipt({
      merchantRaw: "Blue Bottle Coffee",
      merchantNormalized: "Blue Bottle Coffee",
      purchasedAt: "2026-06-15",
      totalCents: 500,
      createdAt: "2026-01-01T00:00:01.000Z",
    });

    const result = await linkOrMerge(DB, {
      receiptId: coffee2,
      sourceId: photoSourceId,
      sourceType: "photo",
      externalId: null,
    });

    expect(result.merged).toBe(false);
    expect(result.refusedReason).toBeNull();
    expect(result.ambiguousMatchCount).toBeNull();
    expect(result.finalReceiptId).toBe(coffee2);
    // Both real, distinct purchases survive intact — the exact
    // catastrophic case the ticket exists to prevent (review round 1,
    // finding 1: without the fix, this merges and DELETEs coffee1).
    expect(await countReceipts([coffee1, coffee2])).toBe(2);
    expect(await countReceiptSources(coffee1)).toBe(0);
    expect(await countReceiptSources(coffee2)).toBe(1);
  });
});

/**
 * Wraps a real D1Database so `onBeforeBatch` runs immediately before
 * `batch()` executes — simulating a write landing in the window between an
 * earlier read (the `duplicateLineItems` check in `linkOrMerge`) and the
 * batch that acts on its result. `prepare` and every other property pass
 * straight through unwrapped so `.bind()/.run()/.first()/.all()` behave
 * identically to the real binding; only `batch` is intercepted.
 */
function withBatchRace(db: D1Database, onBeforeBatch: () => Promise<void>): D1Database {
  return {
    prepare: (query: string) => db.prepare(query),
    batch: async (statements: D1PreparedStatement[]) => {
      await onBeforeBatch();
      return db.batch(statements);
    },
  } as unknown as D1Database;
}

// Test I: the race window between the duplicateLineItems check and
// db.batch() (review round 1, finding 2). A line item lands on the
// duplicate in that window (queue redelivery, a concurrent extraction);
// the unguarded DELETE (no NOT EXISTS) must collide with
// line_items.receipt_id's ON DELETE RESTRICT and abort the whole batch,
// rather than silently deleting 0 rows and leaving a partial merge with a
// double-count.
describe("I: a line item landing on the duplicate mid-race aborts the whole batch (real D1)", () => {
  it("rejects instead of silently partial-committing, and leaves both receipts and the racy line item intact", async () => {
    const survivorId = await insertReceipt({
      merchantRaw: "Trader Joe's",
      merchantNormalized: "Trader Joe's",
      purchasedAt: "2026-06-20",
      totalCents: 4_312,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    // Known provenance — see Test D's comment.
    await linkSourceDirect(survivorId, gmailSourceId);
    const duplicateId = await insertReceipt({
      merchantRaw: "TRADER JOE'S #123",
      merchantNormalized: "TRADER JOE'S #123",
      purchasedAt: "2026-06-20",
      totalCents: 4_312,
      storeLocation: "999 Racy Ave, Nowhere",
      createdAt: "2026-01-01T00:00:01.000Z",
    });

    const racedDb = withBatchRace(DB, async () => {
      // Lands strictly after linkOrMerge's upfront duplicateLineItems
      // check (0 items, not refused) and strictly before its db.batch()
      // call — the exact window review round 1, finding 2 describes.
      await insertLineItem(duplicateId, "RACY ITEM LANDED MID-MERGE");
    });

    await expect(
      linkOrMerge(racedDb, {
        receiptId: duplicateId,
        sourceId: photoSourceId,
        sourceType: "photo",
        externalId: null,
      }),
    ).rejects.toThrow();

    // Atomic abort: db.batch() is all-or-nothing, so none of the four
    // statements committed. Both receipts still stand, the duplicate's
    // receipt_sources were never re-pointed, and — the point of the
    // fix — the racy line item that landed mid-merge is still there, not
    // silently orphaned on a deleted-from-under-it receipt.
    expect(await countReceipts([survivorId, duplicateId])).toBe(2);
    expect(await countLineItems(duplicateId)).toBe(1);
    expect(await countReceiptSources(duplicateId)).toBe(0);
    const survivorRow = await DB.prepare(`SELECT store_location FROM receipts WHERE id = ?`)
      .bind(survivorId)
      .first<{ store_location: string | null }>();
    expect(survivorRow?.store_location).toBeNull();
  });
});

// Test J: statement order inside the batch actually matters (round 2
// review) — through the real linkOrMerge path, not Test B's raw-SQL schema
// backstop. In every other test in this file the duplicate (the row
// deleted by statement 4) enters the merge with zero receipt_sources rows,
// because it never went through its own linkOrMerge call first — so
// statement 1's re-point is a no-op there and DELETE-first would never
// trip ON DELETE RESTRICT even with the statements swapped. That made
// every other test blind to the ordering: mutation testing proved swapping
// statements 1 and 4 leaves all of them green.
//
// This is the missing case: the *candidate* already has a real,
// external_id-bearing receipt_sources row from its own earlier linkOrMerge
// call, and the *incoming* receipt already carries committed line items
// (a re-extraction/backfill — see linkOrMerge's incomingHasLineItems
// comment), so selectSurvivor's line-items preference makes incoming the
// survivor and the already-linked candidate the duplicate. Statement 1
// must re-point that real row before statement 4 deletes the candidate, or
// the delete collides with receipt_sources.receipt_id's ON DELETE
// RESTRICT and the whole batch aborts.
describe("J: re-pointing a real, external_id-bearing receipt_sources row is load-bearing (statement-order proof, real path)", () => {
  it("moves the candidate's gmail link onto the incoming survivor and deletes the candidate", async () => {
    // The candidate already exists and already went through its own
    // linkOrMerge call, so it carries a real receipt_sources row with a
    // real external_id — not the source-link-less duplicate every other
    // test in this file uses.
    const candidateId = await insertReceipt({
      merchantRaw: "Trader Joe's",
      merchantNormalized: "Trader Joe's",
      purchasedAt: "2026-07-05",
      totalCents: 4_312,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const candidateLink = await linkOrMerge(DB, {
      receiptId: candidateId,
      sourceId: gmailSourceId,
      sourceType: "gmail",
      externalId: "gmail-msg-repoint-proof",
    });
    expect(candidateLink).toMatchObject({ merged: false, finalReceiptId: candidateId });

    // The incoming receipt already carries committed line items (a
    // re-extraction/backfill scenario, not the fresh-extraction default) —
    // this is what makes selectSurvivor pick incoming as survivor despite
    // it being the newer row, so the *candidate* is the one re-pointed and
    // deleted rather than the reverse (which every other test exercises).
    const incomingId = await insertReceipt({
      merchantRaw: "TRADER JOE'S #123",
      merchantNormalized: "TRADER JOE'S #123",
      purchasedAt: "2026-07-05",
      totalCents: 4_312,
      createdAt: "2026-01-01T00:00:01.000Z",
    });
    await insertLineItem(incomingId, "PRE-COMMITTED ITEM");

    const result = await linkOrMerge(DB, {
      receiptId: incomingId,
      sourceId: photoSourceId,
      sourceType: "photo",
      externalId: null,
    });

    expect(result.merged).toBe(true);
    expect(result.finalReceiptId).toBe(incomingId);
    expect(result.refusedReason).toBeNull();

    expect(await countReceipts([incomingId, candidateId])).toBe(1);
    // The survivor's own photo link, plus the candidate's re-pointed gmail
    // link — proof statement 1 actually moved a real row, not a no-op.
    expect(await countReceiptSources(incomingId)).toBe(2);

    const repointedLink = await DB.prepare(
      `SELECT receipt_id FROM receipt_sources WHERE external_id = ?`,
    )
      .bind("gmail-msg-repoint-proof")
      .first<{ receipt_id: string }>();
    expect(repointedLink?.receipt_id).toBe(incomingId);
  });
});

// Test K: STON-19 — an already-bound external_id must refuse, never
// silently re-point and strand the holder's only receipt_sources row (the
// bug this ticket fixes). K1 is the exact repro from the ticket, and also
// locks in the round-2 fix that lineItemsAlreadyPresent reads true on this
// path (review round 2, finding 2) — not the literal item count, a
// deliberate mismatch a well-meaning cleanup could revert unnoticed; K2
// proves the guard sits ahead of the merge batch, not just the no-merge
// path; K3 proves the normal Gmail re-sync (same receiptId) is untouched;
// K4 proves the upsert statement itself cannot move a link even in the
// check-then-write race window; K5 proves writeSourceLink (round 2,
// finding 1) turns that same no-op into an observable "not linked" outcome
// instead of a clean success noMerge() would otherwise report.
describe("K: an external_id already bound to a different receipt refuses instead of stealing the link", () => {
  it("K1: refuses and leaves the holder's only source row intact (the stranding repro)", async () => {
    const receiptX = await insertReceipt({
      merchantRaw: "Corner Store X",
      createdAt: "2026-08-01T00:00:00.000Z",
    });
    const linkResult = await linkOrMerge(DB, {
      receiptId: receiptX,
      sourceId: gmailSourceId,
      sourceType: "gmail",
      externalId: "gmail-msg-steal",
    });
    expect(linkResult).toMatchObject({
      merged: false,
      refusedReason: null,
      externalIdBoundTo: null,
    });
    expect(await countReceiptSources(receiptX)).toBe(1);

    const receiptY = await insertReceipt({
      merchantRaw: "Corner Store Y",
      createdAt: "2026-08-01T00:01:00.000Z",
    });
    const stealAttempt = await linkOrMerge(DB, {
      receiptId: receiptY,
      sourceId: gmailSourceId,
      sourceType: "gmail",
      externalId: "gmail-msg-steal",
    });

    expect(stealAttempt.merged).toBe(false);
    expect(stealAttempt.refusedReason).toBe("external-id-bound-to-other-receipt");
    expect(stealAttempt.externalIdBoundTo).toBe(receiptX);
    expect(stealAttempt.finalReceiptId).toBe(receiptY);
    // Review round 2, finding 2: this forced `true` is the entire round-1
    // remedy — receiptY has zero receipt_sources rows (asserted below) yet
    // this must still read `true`, a "do not write" directive rather than
    // a literal count, so restoring the computed
    // `lineItemCount(...) > 0` here (which would read `false`) is a
    // regression this assertion exists to catch.
    expect(stealAttempt.lineItemsAlreadyPresent).toBe(true);

    // The exact zero-source-rows stranding the ticket names — asserted as
    // not happening.
    expect(await countReceiptSources(receiptX)).toBe(1);
    const stillBound = await DB.prepare(
      `SELECT receipt_id FROM receipt_sources WHERE external_id = ?`,
    )
      .bind("gmail-msg-steal")
      .first<{ receipt_id: string }>();
    expect(stillBound?.receipt_id).toBe(receiptX);

    expect(await countReceiptSources(receiptY)).toBe(0);
    expect(await countReceipts([receiptX, receiptY])).toBe(2);
  });

  it("K2: refuses ahead of an otherwise-eligible merge batch — nothing merges, nothing deletes", async () => {
    const receiptZ = await insertReceipt({
      merchantRaw: "Held Store Z",
      createdAt: "2026-08-05T00:00:00.000Z",
    });
    await linkOrMerge(DB, {
      receiptId: receiptZ,
      sourceId: gmailSourceId,
      sourceType: "gmail",
      externalId: "gmail-msg-steal-2",
    });

    // Candidate X and incoming Y would otherwise merge (same merchant,
    // date, total) — X already has known (photo) provenance.
    const candidateX = await insertReceipt({
      merchantRaw: "Merge Candidate",
      merchantNormalized: "Merge Candidate",
      purchasedAt: "2026-08-05",
      totalCents: 1_999,
      createdAt: "2026-08-05T00:01:00.000Z",
    });
    await linkSourceDirect(candidateX, photoSourceId);

    const incomingY = await insertReceipt({
      merchantRaw: "MERGE CANDIDATE",
      merchantNormalized: "MERGE CANDIDATE",
      purchasedAt: "2026-08-05",
      totalCents: 1_999,
      createdAt: "2026-08-05T00:02:00.000Z",
    });

    const result = await linkOrMerge(DB, {
      receiptId: incomingY,
      sourceId: gmailSourceId,
      sourceType: "gmail",
      externalId: "gmail-msg-steal-2",
    });

    expect(result.merged).toBe(false);
    expect(result.refusedReason).toBe("external-id-bound-to-other-receipt");
    expect(result.externalIdBoundTo).toBe(receiptZ);

    // Nothing merged, nothing deleted: all three receipts still exist, Z
    // still holds its link, X keeps its own photo link untouched.
    expect(await countReceipts([receiptZ, candidateX, incomingY])).toBe(3);
    expect(await countReceiptSources(receiptZ)).toBe(1);
    expect(await countReceiptSources(candidateX)).toBe(1);
    expect(await countReceiptSources(incomingY)).toBe(0);
  });

  it("K3: a same-receipt re-bind (the normal Gmail re-sync) is untouched", async () => {
    const receiptId = await insertReceipt({
      merchantRaw: "Resync Store",
      createdAt: "2026-08-10T00:00:00.000Z",
    });
    await linkOrMerge(DB, {
      receiptId,
      sourceId: gmailSourceId,
      sourceType: "gmail",
      externalId: "gmail-msg-selflink",
    });
    const second = await linkOrMerge(DB, {
      receiptId,
      sourceId: gmailSourceId,
      sourceType: "gmail",
      externalId: "gmail-msg-selflink",
    });

    expect(second.refusedReason).toBeNull();
    expect(second.externalIdBoundTo).toBeNull();
    const rows = await DB.prepare(`SELECT COUNT(*) as c FROM receipt_sources WHERE external_id = ?`)
      .bind("gmail-msg-selflink")
      .first<{ c: number }>();
    expect(rows?.c).toBe(1);
  });

  it("K4: the upsert statement itself cannot move a link (race proof)", async () => {
    const receiptX = await insertReceipt({
      merchantRaw: "Race Store X",
      createdAt: "2026-08-15T00:00:00.000Z",
    });
    const receiptY = await insertReceipt({
      merchantRaw: "Race Store Y",
      createdAt: "2026-08-15T00:01:00.000Z",
    });

    // Bind the external_id to X directly — simulating the state the guard
    // already read before a race-window write lands.
    await ensureSourceLinkStatement(DB, {
      receiptId: receiptX,
      sourceId: gmailSourceId,
      externalId: "gmail-msg-race",
    }).run();

    // A statement built for Y with the same external_id — the write that
    // would land after the guard's SELECT in the check-then-write window.
    await expect(
      ensureSourceLinkStatement(DB, {
        receiptId: receiptY,
        sourceId: gmailSourceId,
        externalId: "gmail-msg-race",
      }).run(),
    ).resolves.toBeDefined();

    const row = await DB.prepare(`SELECT receipt_id FROM receipt_sources WHERE external_id = ?`)
      .bind("gmail-msg-race")
      .first<{ receipt_id: string }>();
    expect(row?.receipt_id).toBe(receiptX);

    const count = await DB.prepare(
      `SELECT COUNT(*) as c FROM receipt_sources WHERE external_id = ?`,
    )
      .bind("gmail-msg-race")
      .first<{ c: number }>();
    expect(count?.c).toBe(1);
  });

  it("K5: writeSourceLink observes the race K4 proves, instead of reporting a clean link (round 2)", async () => {
    const receiptX = await insertReceipt({
      merchantRaw: "Race Store A",
      createdAt: "2026-08-16T00:00:00.000Z",
    });
    const receiptY = await insertReceipt({
      merchantRaw: "Race Store B",
      createdAt: "2026-08-16T00:01:00.000Z",
    });

    // Same setup as K4: bind the external_id to X directly, simulating a
    // concurrent call's write landing in the gap between this call's own
    // upfront guard SELECT (already proven unable to see it, K4) and its
    // write. Driving writeSourceLink for Y here is exactly the write
    // noMerge() performs on that path.
    await ensureSourceLinkStatement(DB, {
      receiptId: receiptX,
      sourceId: gmailSourceId,
      externalId: "gmail-msg-race-observed",
    }).run();

    const outcome = await writeSourceLink(DB, {
      receiptId: receiptY,
      sourceId: gmailSourceId,
      externalId: "gmail-msg-race-observed",
    });

    // K4 already proves the row itself never moves. This proves the
    // *caller* is told that — not a silent `{ linked: true }` that would
    // send noMerge() on to report a clean success for a link it never
    // made (review round 2, finding 1).
    expect(outcome.linked).toBe(false);
    expect(outcome.boundTo).toBe(receiptX);

    const row = await DB.prepare(`SELECT receipt_id FROM receipt_sources WHERE external_id = ?`)
      .bind("gmail-msg-race-observed")
      .first<{ receipt_id: string }>();
    expect(row?.receipt_id).toBe(receiptX);
    expect(await countReceiptSources(receiptY)).toBe(0);
  });
});
