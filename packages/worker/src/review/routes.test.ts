import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const DB = env.DB;

async function seedReviewItem(
  purchasedAt: string,
): Promise<{ receiptId: string; queueId: string }> {
  const receiptId = crypto.randomUUID();
  const lineItemId = crypto.randomUUID();
  const queueId = crypto.randomUUID();
  await DB.prepare(
    `INSERT INTO receipts (id, merchant_raw, purchased_at, status) VALUES (?, 'ROUTES TEST MART', ?, 'needs_review')`,
  )
    .bind(receiptId, purchasedAt)
    .run();
  await DB.prepare(
    `INSERT INTO line_items (id, receipt_id, raw_text, category, extended_price_cents, taxonomy_version)
     VALUES (?, ?, 'ROUTES RAW LINE', 'pantry', 250, '0.1.0')`,
  )
    .bind(lineItemId, receiptId)
    .run();
  await DB.prepare(
    `INSERT INTO review_queue (id, line_item_id, reason) VALUES (?, ?, 'low_confidence')`,
  )
    .bind(queueId, lineItemId)
    .run();
  return { receiptId, queueId };
}

describe("GET /api/review/next", () => {
  it("orders unresolved items most-recent-purchase-first", async () => {
    const older = await seedReviewItem("2020-01-01");
    const newer = await seedReviewItem("2029-01-01");

    const res = await SELF.fetch("https://example.com/api/review/next?limit=50");
    expect(res.status).toBe(200);
    const body = await res.json<{ items: Array<{ queueId: string; purchasedAt: string }> }>();

    const ids = body.items.map((i) => i.queueId);
    expect(ids.indexOf(newer.queueId)).toBeLessThan(ids.indexOf(older.queueId));
  });

  it("never includes a resolved item", async () => {
    const { queueId } = await seedReviewItem("2027-05-05");
    await SELF.fetch(`https://example.com/api/review/${queueId}/verdict`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ verdict: "confirmed" }),
    });

    const res = await SELF.fetch("https://example.com/api/review/next?limit=200");
    const body = await res.json<{ items: Array<{ queueId: string }> }>();
    expect(body.items.map((i) => i.queueId)).not.toContain(queueId);
  });
});

describe("POST /api/review/:queueId/verdict", () => {
  it("confirms a line item and reports goldenSetWritten", async () => {
    const { queueId } = await seedReviewItem("2026-04-04");
    const res = await SELF.fetch(`https://example.com/api/review/${queueId}/verdict`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ verdict: "confirmed" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean; goldenSetWritten: boolean }>();
    expect(body.ok).toBe(true);
    expect(body.goldenSetWritten).toBe(true);
  });

  it("404s for an unknown queueId", async () => {
    const res = await SELF.fetch(`https://example.com/api/review/${crypto.randomUUID()}/verdict`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ verdict: "confirmed" }),
    });
    expect(res.status).toBe(404);
  });

  it("400s for an invalid verdict value", async () => {
    const { queueId } = await seedReviewItem("2026-04-05");
    const res = await SELF.fetch(`https://example.com/api/review/${queueId}/verdict`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ verdict: "maybe" }),
    });
    expect(res.status).toBe(400);
  });
});
