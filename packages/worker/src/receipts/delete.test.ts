import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { deleteReceipt, deleteReceiptStatements } from "./delete.js";

/**
 * Integration coverage for STON-18's ordered receipt delete — against the
 * real local D1 and R2 bindings (migrations/0001_initial_schema.sql),
 * never a mocked database (AGENTS.md, Testing). The two load-bearing
 * cases are "ordering is load-bearing" and "golden-set lock-in": the
 * first proves RESTRICT still fires if the delete order is ever gotten
 * wrong, the second proves a receipt delete never touches golden_set.
 */

const DB = env.DB;
const RECEIPTS = env.RECEIPTS;

interface Fixture {
  receiptId: string;
  r2Key: string;
  gmailSourceId: string;
  photoSourceId: string;
  lineItemId1: string;
  lineItemId2: string;
  openReviewQueueId: string;
  resolvedReviewQueueId: string;
  goldenSetId1: string;
  goldenSetId2: string;
}

async function insertSource(type: "gmail" | "photo"): Promise<string> {
  const id = crypto.randomUUID();
  await DB.prepare(`INSERT INTO sources (id, type, auth_state) VALUES (?, ?, 'not_applicable')`)
    .bind(id, type)
    .run();
  return id;
}

async function insertReceipt(r2Key: string | null): Promise<string> {
  const id = crypto.randomUUID();
  await DB.prepare(
    `INSERT INTO receipts (id, merchant_raw, merchant_normalized, purchased_at, total_cents, r2_key)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, "TRADER JOE'S #123", "Trader Joe's", "2026-06-01", 4_312, r2Key)
    .run();
  return id;
}

async function insertReceiptSource(
  receiptId: string,
  sourceId: string,
  externalId: string | null,
): Promise<string> {
  const id = crypto.randomUUID();
  await DB.prepare(
    `INSERT INTO receipt_sources (id, receipt_id, source_id, external_id) VALUES (?, ?, ?, ?)`,
  )
    .bind(id, receiptId, sourceId, externalId)
    .run();
  return id;
}

async function insertLineItem(receiptId: string, rawText: string): Promise<string> {
  const id = crypto.randomUUID();
  await DB.prepare(
    `INSERT INTO line_items (id, receipt_id, raw_text, taxonomy_version) VALUES (?, ?, ?, '0.1.0')`,
  )
    .bind(id, receiptId, rawText)
    .run();
  return id;
}

async function insertReviewQueue(
  lineItemId: string,
  verdict: "confirmed" | "corrected" | "skipped" | null,
): Promise<string> {
  const id = crypto.randomUUID();
  await DB.prepare(
    `INSERT INTO review_queue (id, line_item_id, reason, verdict, resolved_at)
     VALUES (?, ?, 'low_confidence', ?, ?)`,
  )
    .bind(id, lineItemId, verdict, verdict === null ? null : "2026-06-01T00:00:00.000Z")
    .run();
  return id;
}

async function insertGoldenSet(rawString: string, labeler: string): Promise<string> {
  const id = crypto.randomUUID();
  await DB.prepare(
    `INSERT INTO golden_set (id, raw_string, verdict, labeler, taxonomy_version)
     VALUES (?, ?, 'corrected', ?, '0.1.0')`,
  )
    .bind(id, rawString, labeler)
    .run();
  return id;
}

async function countWhere(table: string, column: string, value: string): Promise<number> {
  const row = await DB.prepare(`SELECT COUNT(*) as c FROM ${table} WHERE ${column} = ?`)
    .bind(value)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

async function buildFixture(): Promise<Fixture> {
  const r2Key = `user-1/2026/06/${crypto.randomUUID()}`;
  await RECEIPTS.put(r2Key, "fake receipt image bytes");

  const receiptId = await insertReceipt(r2Key);
  const gmailSourceId = await insertSource("gmail");
  const photoSourceId = await insertSource("photo");
  await insertReceiptSource(
    receiptId,
    gmailSourceId,
    `gmail-msg-delete-fixture-${crypto.randomUUID()}`,
  );
  await insertReceiptSource(receiptId, photoSourceId, null);

  const lineItemId1 = await insertLineItem(receiptId, "ORG BANANAS 1.24 LB @ .79/LB");
  const lineItemId2 = await insertLineItem(receiptId, "WHOLE MILK 1GAL");

  const openReviewQueueId = await insertReviewQueue(lineItemId1, null);
  const resolvedReviewQueueId = await insertReviewQueue(lineItemId2, "corrected");

  // Written as the resolved verdict above would have written it —
  // immediately, in the same step (AGENTS.md, "the golden set is the
  // product"). No receipt_id, user_id, or purchase timestamp: the
  // anonymization boundary is enforced by the absence of those columns.
  const goldenSetId1 = await insertGoldenSet("WHOLE MILK 1GAL", "labeler-1");
  const goldenSetId2 = await insertGoldenSet("ORG BANANAS 1.24 LB @ .79/LB", "labeler-1");

  return {
    receiptId,
    r2Key,
    gmailSourceId,
    photoSourceId,
    lineItemId1,
    lineItemId2,
    openReviewQueueId,
    resolvedReviewQueueId,
    goldenSetId1,
    goldenSetId2,
  };
}

let fixture: Fixture;

beforeEach(async () => {
  fixture = await buildFixture();
});

describe("happy path", () => {
  it("deletes the receipt, its line items, its queue rows, and its source links, and reports matching counts", async () => {
    const result = await deleteReceipt(DB, RECEIPTS, fixture.receiptId);

    expect(result.deleted).toBe(true);
    expect(result.lineItemsDeleted).toBe(2);
    expect(result.reviewQueueRowsDeleted).toBe(2);
    expect(result.sourceLinksDeleted).toBe(2);
    expect(result.r2Key).toBe(fixture.r2Key);
    expect(result.r2Deleted).toBe(true);

    const receiptRow = await DB.prepare(`SELECT id FROM receipts WHERE id = ?`)
      .bind(fixture.receiptId)
      .first();
    expect(receiptRow).toBeNull();
    expect(await countWhere("line_items", "receipt_id", fixture.receiptId)).toBe(0);
    expect(await countWhere("receipt_sources", "receipt_id", fixture.receiptId)).toBe(0);
    expect(await countWhere("review_queue", "line_item_id", fixture.lineItemId1)).toBe(0);
    expect(await countWhere("review_queue", "line_item_id", fixture.lineItemId2)).toBe(0);

    // sources rows themselves are never deleted by this path — a
    // disconnect is an UPDATE, not a DELETE (module doc).
    const gmailSource = await DB.prepare(`SELECT id FROM sources WHERE id = ?`)
      .bind(fixture.gmailSourceId)
      .first();
    expect(gmailSource).not.toBeNull();
    const photoSource = await DB.prepare(`SELECT id FROM sources WHERE id = ?`)
      .bind(fixture.photoSourceId)
      .first();
    expect(photoSource).not.toBeNull();
  });
});

describe("golden-set lock-in (the ticket's central regression guard)", () => {
  it("leaves both golden_set rows byte-identical after the receipt is deleted", async () => {
    const before = await DB.prepare(
      `SELECT id, raw_string, verdict, labeler, taxonomy_version FROM golden_set WHERE id IN (?, ?) ORDER BY id`,
    )
      .bind(fixture.goldenSetId1, fixture.goldenSetId2)
      .all();

    const result = await deleteReceipt(DB, RECEIPTS, fixture.receiptId);
    expect(result.deleted).toBe(true);

    const after = await DB.prepare(
      `SELECT id, raw_string, verdict, labeler, taxonomy_version FROM golden_set WHERE id IN (?, ?) ORDER BY id`,
    )
      .bind(fixture.goldenSetId1, fixture.goldenSetId2)
      .all();

    expect(after.results).toEqual(before.results);
    expect(after.results.length).toBe(2);
  });
});

describe("R2", () => {
  it("removes the R2 object at the receipt's r2_key", async () => {
    expect(await RECEIPTS.get(fixture.r2Key)).not.toBeNull();

    await deleteReceipt(DB, RECEIPTS, fixture.receiptId);

    expect(await RECEIPTS.get(fixture.r2Key)).toBeNull();
  });

  it("a receipt with r2_key IS NULL (email-only) deletes cleanly with r2Deleted: false and no throw", async () => {
    const emailOnlyReceiptId = await insertReceipt(null);
    const lineItemId = await insertLineItem(emailOnlyReceiptId, "EMAIL ONLY ITEM");

    const result = await deleteReceipt(DB, RECEIPTS, emailOnlyReceiptId);

    expect(result.deleted).toBe(true);
    expect(result.r2Key).toBeNull();
    expect(result.r2Deleted).toBe(false);
    expect(result.lineItemsDeleted).toBe(1);

    const receiptRow = await DB.prepare(`SELECT id FROM receipts WHERE id = ?`)
      .bind(emailOnlyReceiptId)
      .first();
    expect(receiptRow).toBeNull();
    const lineItemRow = await DB.prepare(`SELECT id FROM line_items WHERE id = ?`)
      .bind(lineItemId)
      .first();
    expect(lineItemRow).toBeNull();
  });
});

describe("ordering is load-bearing (the ticket's actual regression guard)", () => {
  it("rolls back a receipt_sources delete that already succeeded, once a later statement in the same batch hits RESTRICT", async () => {
    const statements = deleteReceiptStatements(DB, fixture.receiptId);
    const [reviewQueueStmt, lineItemsStmt, receiptSourcesStmt, receiptsStmt] = statements as [
      D1PreparedStatement,
      D1PreparedStatement,
      D1PreparedStatement,
      D1PreparedStatement,
    ];

    // receipt_sources has nothing referencing it, so deleting it first
    // succeeds on its own — but receipts (next) still has line_items
    // pointing at it, because line_items is pushed to third in this
    // order. ON DELETE RESTRICT fires there, and db.batch must then roll
    // back the receipt_sources delete that already succeeded, not just
    // leave it never-attempted the way a full reversal would (that case,
    // where nothing ever runs, is "the naive path still fails loudly"
    // below — it does not exercise rollback of a partial success).
    const reordered = [receiptSourcesStmt, receiptsStmt, lineItemsStmt, reviewQueueStmt];

    await expect(DB.batch(reordered)).rejects.toThrow();

    const receiptRow = await DB.prepare(`SELECT id FROM receipts WHERE id = ?`)
      .bind(fixture.receiptId)
      .first();
    expect(receiptRow).not.toBeNull();
    expect(await countWhere("line_items", "receipt_id", fixture.receiptId)).toBe(2);
    // The load-bearing assertion: receipt_sources' delete ran and
    // succeeded within this batch (it has no RESTRICT of its own), so
    // this count is only back to 2 because db.batch rolled the whole
    // partial attempt back atomically when receipts hit RESTRICT next.
    expect(await countWhere("receipt_sources", "receipt_id", fixture.receiptId)).toBe(2);
    expect(await countWhere("review_queue", "line_item_id", fixture.lineItemId1)).toBe(1);
    expect(await countWhere("review_queue", "line_item_id", fixture.lineItemId2)).toBe(1);

    // The real (correct) order still succeeds against the same graph.
    await expect(DB.batch(statements)).resolves.toBeDefined();
  });
});

describe("the naive path still fails loudly", () => {
  it("a bare DELETE FROM receipts on the populated graph rejects (duplicates schema.test.ts's assertion, on purpose)", async () => {
    await expect(
      DB.prepare(`DELETE FROM receipts WHERE id = ?`).bind(fixture.receiptId).run(),
    ).rejects.toThrow();

    const receiptRow = await DB.prepare(`SELECT id FROM receipts WHERE id = ?`)
      .bind(fixture.receiptId)
      .first();
    expect(receiptRow).not.toBeNull();
  });
});

describe("idempotence", () => {
  it("deleteReceipt on an unknown id returns { deleted: false } and touches nothing", async () => {
    const result = await deleteReceipt(DB, RECEIPTS, crypto.randomUUID());

    expect(result).toEqual({
      deleted: false,
      lineItemsDeleted: 0,
      reviewQueueRowsDeleted: 0,
      sourceLinksDeleted: 0,
      r2Key: null,
      r2Deleted: false,
      r2Error: null,
    });

    // The fixture's own graph is untouched by a delete of an unrelated id.
    const receiptRow = await DB.prepare(`SELECT id FROM receipts WHERE id = ?`)
      .bind(fixture.receiptId)
      .first();
    expect(receiptRow).not.toBeNull();
  });
});
