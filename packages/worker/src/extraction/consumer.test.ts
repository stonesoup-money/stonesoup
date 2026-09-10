import { env } from "cloudflare:test";
import type { ExtractionJob } from "@stonesoup/core";
import { describe, expect, it } from "vitest";
import { processExtractionJob } from "./consumer.js";
import { createFixtureExtractionClient } from "./fixture-client.js";
import checksumFailFixture from "./fixtures/general-mart-checksum-fail.json";
import passFixture from "./fixtures/general-mart-pass.json";

const DB = env.DB;
const RECEIPTS = env.RECEIPTS;

const TEST_USER_ID = "consumer-test-user";

async function ensurePhotoSource(userId: string): Promise<void> {
  await DB.prepare(
    `INSERT INTO sources (id, type, auth_state) VALUES (?, 'photo', 'not_applicable')
     ON CONFLICT (id) DO NOTHING`,
  )
    .bind(`photo:${userId}`)
    .run();
}

async function seedPendingReceipt(): Promise<{ receiptId: string; r2Key: string }> {
  await ensurePhotoSource(TEST_USER_ID);
  const receiptId = crypto.randomUUID();
  const r2Key = `${TEST_USER_ID}/2026/08/${receiptId}`;
  await DB.prepare(`INSERT INTO receipts (id, r2_key, status) VALUES (?, ?, 'pending')`)
    .bind(receiptId, r2Key)
    .run();
  await RECEIPTS.put(r2Key, new Uint8Array([1, 2, 3]), {
    httpMetadata: { contentType: "image/jpeg" },
  });
  return { receiptId, r2Key };
}

function buildJob(receiptId: string, r2Key: string): ExtractionJob {
  return { receiptId, r2Key, userId: TEST_USER_ID, modality: "vision", schemaVersion: 1 };
}

describe("processExtractionJob — checksum pass", () => {
  it("writes merchant fields, line items with taxonomy_version, and moves the receipt to extracted", async () => {
    const { receiptId, r2Key } = await seedPendingReceipt();
    await processExtractionJob(
      env,
      buildJob(receiptId, r2Key),
      createFixtureExtractionClient(passFixture),
    );

    const receipt = await DB.prepare(
      `SELECT merchant_raw, status, checksum_result FROM receipts WHERE id = ?`,
    )
      .bind(receiptId)
      .first<{ merchant_raw: string; status: string; checksum_result: string }>();
    expect(receipt?.merchant_raw).toBe("GENERAL MART #42");
    expect(receipt?.status).toBe("extracted");
    expect(receipt?.checksum_result).toBe("pass");

    const lineItems = await DB.prepare(
      `SELECT taxonomy_version, category FROM line_items WHERE receipt_id = ? ORDER BY line_number`,
    )
      .bind(receiptId)
      .all<{ taxonomy_version: string; category: string }>();
    expect(lineItems.results).toHaveLength(4);
    for (const item of lineItems.results) {
      expect(item.taxonomy_version).toBe("0.1.0");
    }

    const reviewRows = await DB.prepare(
      `SELECT COUNT(*) as c FROM review_queue rq
        JOIN line_items li ON li.id = rq.line_item_id
       WHERE li.receipt_id = ?`,
    )
      .bind(receiptId)
      .first<{ c: number }>();
    expect(reviewRows?.c).toBe(4);
  });

  it("replaying the same job writes no duplicate line items or review rows", async () => {
    const { receiptId, r2Key } = await seedPendingReceipt();
    const job = buildJob(receiptId, r2Key);
    await processExtractionJob(env, job, createFixtureExtractionClient(passFixture));
    await processExtractionJob(env, job, createFixtureExtractionClient(passFixture));

    const lineItems = await DB.prepare(`SELECT COUNT(*) as c FROM line_items WHERE receipt_id = ?`)
      .bind(receiptId)
      .first<{ c: number }>();
    expect(lineItems?.c).toBe(4);

    const reviewRows = await DB.prepare(
      `SELECT COUNT(*) as c FROM review_queue rq
        JOIN line_items li ON li.id = rq.line_item_id
       WHERE li.receipt_id = ?`,
    )
      .bind(receiptId)
      .first<{ c: number }>();
    expect(reviewRows?.c).toBe(4);
  });
});

describe("processExtractionJob — checksum fail", () => {
  it("routes the whole receipt to needs_review with checksum_fail on every line item, regardless of individual confidence", async () => {
    const { receiptId, r2Key } = await seedPendingReceipt();
    await processExtractionJob(
      env,
      buildJob(receiptId, r2Key),
      createFixtureExtractionClient(checksumFailFixture),
    );

    const receipt = await DB.prepare(`SELECT status, checksum_result FROM receipts WHERE id = ?`)
      .bind(receiptId)
      .first<{ status: string; checksum_result: string }>();
    expect(receipt?.status).toBe("needs_review");
    expect(receipt?.checksum_result).toBe("fail");

    const reasons = await DB.prepare(
      `SELECT DISTINCT rq.reason FROM review_queue rq
        JOIN line_items li ON li.id = rq.line_item_id
       WHERE li.receipt_id = ?`,
    )
      .bind(receiptId)
      .all<{ reason: string }>();
    expect(reasons.results.map((r) => r.reason)).toEqual(["checksum_fail"]);
  });
});

describe("processExtractionJob — failure paths", () => {
  it("marks the receipt failed and throws when the R2 object is missing", async () => {
    await ensurePhotoSource(TEST_USER_ID);
    const receiptId = crypto.randomUUID();
    const r2Key = `${TEST_USER_ID}/2026/08/${receiptId}`;
    await DB.prepare(`INSERT INTO receipts (id, r2_key, status) VALUES (?, ?, 'pending')`)
      .bind(receiptId, r2Key)
      .run();

    await expect(
      processExtractionJob(
        env,
        buildJob(receiptId, r2Key),
        createFixtureExtractionClient(passFixture),
      ),
    ).rejects.toThrow();

    const receipt = await DB.prepare(`SELECT status FROM receipts WHERE id = ?`)
      .bind(receiptId)
      .first<{ status: string }>();
    expect(receipt?.status).toBe("failed");
  });

  it("marks the receipt failed and throws on a malformed extraction result", async () => {
    const { receiptId, r2Key } = await seedPendingReceipt();
    await expect(
      processExtractionJob(
        env,
        buildJob(receiptId, r2Key),
        createFixtureExtractionClient({ not: "a valid extraction" }),
      ),
    ).rejects.toThrow();

    const receipt = await DB.prepare(`SELECT status FROM receipts WHERE id = ?`)
      .bind(receiptId)
      .first<{ status: string }>();
    expect(receipt?.status).toBe("failed");
  });
});
