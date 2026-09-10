import { env } from "cloudflare:test";
import type { ExtractionResult } from "@stonesoup/core";
import { describe, expect, it } from "vitest";
import { persistExtraction } from "./persist.js";

const DB = env.DB;

function buildResult(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    schema_version: 1,
    taxonomy_version: "0.1.0",
    merchant_raw: "SYNTH MART #9",
    merchant_normalized: "Synth Mart",
    store_location: null,
    purchased_at: "2026-07-15",
    subtotal_cents: 500,
    tax_cents: 0,
    total_cents: 500,
    payment_last4: null,
    line_items: [
      {
        raw_text: "SYNTH ITEM",
        normalized_name: "Synth Item",
        qty: 1,
        unit_price_cents: 500,
        extended_price_cents: 500,
        discount_cents: null,
        category: "pantry",
        subcategory: null,
        confidence: 0.9,
      },
    ],
    ...overrides,
  };
}

async function ensurePhotoSource(userId: string): Promise<void> {
  await DB.prepare(
    `INSERT INTO sources (id, type, auth_state) VALUES (?, 'photo', 'not_applicable')
     ON CONFLICT (id) DO NOTHING`,
  )
    .bind(`photo:${userId}`)
    .run();
}

describe("persistExtraction — linkOrMerge runs before line items are written", () => {
  it("merges into an existing email-side receipt that already carries committed line items", async () => {
    await ensurePhotoSource("merge-test-user");
    // Seed the "email side" — already extracted, already has one line item.
    const emailReceiptId = crypto.randomUUID();
    await DB.prepare(
      `INSERT INTO receipts (id, merchant_raw, merchant_normalized, purchased_at, total_cents, status)
       VALUES (?, 'Synth Mart Receipt Email', 'Synth Mart', '2026-07-20', 777, 'extracted')`,
    )
      .bind(emailReceiptId)
      .run();
    await DB.prepare(
      `INSERT INTO line_items (id, receipt_id, raw_text, category, taxonomy_version)
       VALUES (?, ?, 'EMAIL SIDE ITEM', 'pantry', '0.1.0')`,
    )
      .bind(`${emailReceiptId}:1`, emailReceiptId)
      .run();
    const emailSourceId = crypto.randomUUID();
    await DB.prepare(`INSERT INTO sources (id, type, auth_state) VALUES (?, 'gmail', 'connected')`)
      .bind(emailSourceId)
      .run();
    await DB.prepare(
      `INSERT INTO receipt_sources (id, receipt_id, source_id, external_id) VALUES (?, ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), emailReceiptId, emailSourceId, "gmail-msg-merge-test")
      .run();

    // The photo side — a bare pending row, extraction about to be persisted.
    const photoReceiptId = crypto.randomUUID();
    await DB.prepare(`INSERT INTO receipts (id, status) VALUES (?, 'pending')`)
      .bind(photoReceiptId)
      .run();

    const result = buildResult({
      merchant_normalized: "Synth Mart",
      purchased_at: "2026-07-20",
      total_cents: 777,
    });

    const outcome = await persistExtraction(env, {
      receiptId: photoReceiptId,
      userId: "merge-test-user",
      sourceType: "photo",
      result,
      extractionModel: "fixture-model",
      inputTokens: 1,
      outputTokens: 1,
    });

    expect(outcome.merged).toBe(true);
    expect(outcome.finalReceiptId).toBe(emailReceiptId);
    // The incoming extraction's line items must NOT be written — the
    // survivor already carries committed items.
    expect(outcome.lineItemsWritten).toBe(0);

    const survivorLineItems = await DB.prepare(
      `SELECT COUNT(*) as c FROM line_items WHERE receipt_id = ?`,
    )
      .bind(emailReceiptId)
      .first<{ c: number }>();
    expect(survivorLineItems?.c).toBe(1);

    // The photo receipt (the duplicate) is gone — merged away.
    const photoRow = await DB.prepare(`SELECT id FROM receipts WHERE id = ?`)
      .bind(photoReceiptId)
      .first();
    expect(photoRow).toBeNull();
  });

  it("does not merge when nothing matches — the photo receipt stands alone with its own line items", async () => {
    await ensurePhotoSource("standalone-user");
    const photoReceiptId = crypto.randomUUID();
    await DB.prepare(`INSERT INTO receipts (id, status) VALUES (?, 'pending')`)
      .bind(photoReceiptId)
      .run();

    const outcome = await persistExtraction(env, {
      receiptId: photoReceiptId,
      userId: "standalone-user",
      sourceType: "photo",
      result: buildResult({ purchased_at: "2026-01-01", total_cents: 12345 }),
      extractionModel: "fixture-model",
      inputTokens: 1,
      outputTokens: 1,
    });

    expect(outcome.merged).toBe(false);
    expect(outcome.finalReceiptId).toBe(photoReceiptId);
    expect(outcome.lineItemsWritten).toBe(1);
  });
});
