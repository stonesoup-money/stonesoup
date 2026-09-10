import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { writeVerdict } from "./verdict.js";

const DB = env.DB;

async function seedReviewItem(
  overrides: { purchasedAt?: string; category?: string; confidence?: number | null } = {},
): Promise<{ receiptId: string; lineItemId: string; queueId: string }> {
  const receiptId = crypto.randomUUID();
  const lineItemId = crypto.randomUUID();
  const queueId = crypto.randomUUID();
  await DB.prepare(
    `INSERT INTO receipts (id, merchant_raw, purchased_at, status) VALUES (?, 'VERDICT TEST MART', ?, 'needs_review')`,
  )
    .bind(receiptId, overrides.purchasedAt ?? "2026-06-01")
    .run();
  await DB.prepare(
    `INSERT INTO line_items (id, receipt_id, raw_text, category, confidence, taxonomy_version)
     VALUES (?, ?, 'RAW LINE TEXT', ?, ?, '0.1.0')`,
  )
    .bind(lineItemId, receiptId, overrides.category ?? "pantry", overrides.confidence ?? 0.5)
    .run();
  await DB.prepare(
    `INSERT INTO review_queue (id, line_item_id, reason) VALUES (?, ?, 'low_confidence')`,
  )
    .bind(queueId, lineItemId)
    .run();
  return { receiptId, lineItemId, queueId };
}

describe("writeVerdict — golden_set write path (Review invariant 3, 16)", () => {
  it("a confirmed verdict writes exactly one golden_set row with no receipt/user/store/purchase-timestamp fields", async () => {
    const { queueId } = await seedReviewItem();
    const labeler = `labeler-${crypto.randomUUID()}`;
    const outcome = await writeVerdict(DB, {
      queueId,
      verdict: "confirmed",
      labeler,
    });
    expect(outcome).toEqual({ ok: true, goldenSetWritten: true });

    // Scoped by this test's own unique labeler — D1 is isolated per test
    // *file*, not per test, so an unscoped COUNT(*) here would see rows
    // from every other test in this file.
    const rows = await DB.prepare(
      `SELECT raw_string, verdict, labeler, model_category, taxonomy_version FROM golden_set WHERE labeler = ?`,
    )
      .bind(labeler)
      .all<{
        raw_string: string;
        verdict: string;
        labeler: string;
        model_category: string;
        taxonomy_version: string;
      }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]?.raw_string).toBe("RAW LINE TEXT");
    expect(rows.results[0]?.verdict).toBe("confirmed");
    expect(rows.results[0]?.labeler).toBe(labeler);
    expect(rows.results[0]?.model_category).toBe("pantry");
    expect(rows.results[0]?.taxonomy_version).toBe("0.1.0");

    // Structural: the golden_set schema itself has no receipt id, user id,
    // store, or purchase-timestamp column at all (migration 0001's header).
    const columns = await DB.prepare(`PRAGMA table_info(golden_set)`).all<{ name: string }>();
    const names = columns.results.map((c) => c.name);
    expect(names).not.toContain("receipt_id");
    expect(names).not.toContain("user_id");
    expect(names).not.toContain("store");
    expect(names).not.toContain("purchased_at");
  });

  it("resolves the review_queue row and confirms the line item", async () => {
    const { queueId, lineItemId } = await seedReviewItem();
    await writeVerdict(DB, {
      queueId,
      verdict: "confirmed",
      labeler: `labeler-${crypto.randomUUID()}`,
    });

    const queueRow = await DB.prepare(`SELECT verdict, resolved_at FROM review_queue WHERE id = ?`)
      .bind(queueId)
      .first<{ verdict: string; resolved_at: string | null }>();
    expect(queueRow?.verdict).toBe("confirmed");
    expect(queueRow?.resolved_at).not.toBeNull();

    const lineItem = await DB.prepare(`SELECT status FROM line_items WHERE id = ?`)
      .bind(lineItemId)
      .first<{ status: string }>();
    expect(lineItem?.status).toBe("confirmed");
  });

  it("a corrected verdict writes the corrected category to both golden_set and line_items, never touching raw_text", async () => {
    const { queueId, lineItemId } = await seedReviewItem({ category: "produce" });
    const labeler = `labeler-${crypto.randomUUID()}`;
    await writeVerdict(DB, {
      queueId,
      verdict: "corrected",
      correctedCategory: "pantry",
      labeler,
    });

    const lineItem = await DB.prepare(
      `SELECT status, category, raw_text FROM line_items WHERE id = ?`,
    )
      .bind(lineItemId)
      .first<{ status: string; category: string; raw_text: string }>();
    expect(lineItem?.status).toBe("corrected");
    expect(lineItem?.category).toBe("pantry");
    expect(lineItem?.raw_text).toBe("RAW LINE TEXT");

    const goldenSet = await DB.prepare(
      `SELECT corrected_category FROM golden_set WHERE labeler = ?`,
    )
      .bind(labeler)
      .first<{ corrected_category: string }>();
    expect(goldenSet?.corrected_category).toBe("pantry");
  });

  it("a skipped verdict writes no golden_set row and leaves the line item's category untouched", async () => {
    const { queueId, lineItemId } = await seedReviewItem({ category: "produce" });
    const labeler = `labeler-${crypto.randomUUID()}`;
    const outcome = await writeVerdict(DB, { queueId, verdict: "skipped", labeler });
    expect(outcome).toEqual({ ok: true, goldenSetWritten: false });

    const goldenSetCount = await DB.prepare(
      `SELECT COUNT(*) as c FROM golden_set WHERE labeler = ?`,
    )
      .bind(labeler)
      .first<{ c: number }>();
    expect(goldenSetCount?.c).toBe(0);

    const queueRow = await DB.prepare(`SELECT verdict, resolved_at FROM review_queue WHERE id = ?`)
      .bind(queueId)
      .first<{ verdict: string; resolved_at: string | null }>();
    expect(queueRow?.verdict).toBe("skipped");
    expect(queueRow?.resolved_at).not.toBeNull();

    const lineItem = await DB.prepare(`SELECT category, status FROM line_items WHERE id = ?`)
      .bind(lineItemId)
      .first<{ category: string; status: string }>();
    expect(lineItem?.category).toBe("produce");
  });

  it("replaying a verdict yields exactly one golden_set row", async () => {
    const { queueId } = await seedReviewItem();
    await writeVerdict(DB, { queueId, verdict: "confirmed", labeler: "labeler-replay" });
    await writeVerdict(DB, { queueId, verdict: "confirmed", labeler: "labeler-replay" });

    const count = await DB.prepare(
      `SELECT COUNT(*) as c FROM golden_set WHERE labeler = 'labeler-replay'`,
    ).first<{ c: number }>();
    expect(count?.c).toBe(1);
  });

  it("returns not-found for an unknown queueId", async () => {
    const outcome = await writeVerdict(DB, {
      queueId: crypto.randomUUID(),
      verdict: "confirmed",
      labeler: "labeler-abc",
    });
    expect(outcome).toEqual({ ok: false, error: "not-found" });
  });
});
