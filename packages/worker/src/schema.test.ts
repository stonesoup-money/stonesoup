import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * Convention tests: each assertion here is a real D1 statement against the
 * migrated database (migrations/0001_initial_schema.sql), proving the data
 * conventions are structurally enforced, not just documented.
 */

const DB = env.DB;

let receiptId: string;
let lineItemId: string;
let sourceId: string;

beforeEach(async () => {
  receiptId = crypto.randomUUID();
  lineItemId = crypto.randomUUID();
  sourceId = crypto.randomUUID();

  await DB.prepare(`INSERT INTO receipts (id, merchant_raw, total_cents) VALUES (?, ?, ?)`)
    .bind(receiptId, "TRADER JOE'S #123", 1234)
    .run();

  await DB.prepare(
    `INSERT INTO line_items (id, receipt_id, raw_text, taxonomy_version) VALUES (?, ?, ?, ?)`,
  )
    .bind(lineItemId, receiptId, "ORG BANANAS  1.24 LB @ .79/LB", "0.1.0")
    .run();

  await DB.prepare(
    `INSERT INTO sources (id, type, auth_state) VALUES (?, 'photo', 'not_applicable')`,
  )
    .bind(sourceId)
    .run();
});

describe("raw text is never overwritten", () => {
  it("rejects an UPDATE of line_items.raw_text and leaves the row unchanged", async () => {
    await expect(
      DB.prepare(`UPDATE line_items SET raw_text = 'CORRECTED TEXT' WHERE id = ?`)
        .bind(lineItemId)
        .run(),
    ).rejects.toThrow(/immutable/);

    const row = await DB.prepare(`SELECT raw_text FROM line_items WHERE id = ?`)
      .bind(lineItemId)
      .first<{
        raw_text: string;
      }>();
    expect(row?.raw_text).toBe("ORG BANANAS  1.24 LB @ .79/LB");
  });

  it("rejects an UPDATE of receipts.merchant_raw and leaves the row unchanged", async () => {
    await expect(
      DB.prepare(`UPDATE receipts SET merchant_raw = 'SOMETHING ELSE' WHERE id = ?`)
        .bind(receiptId)
        .run(),
    ).rejects.toThrow(/immutable/);

    const row = await DB.prepare(`SELECT merchant_raw FROM receipts WHERE id = ?`)
      .bind(receiptId)
      .first<{
        merchant_raw: string;
      }>();
    expect(row?.merchant_raw).toBe("TRADER JOE'S #123");
  });

  it("allows updating other columns on the same row", async () => {
    await expect(
      DB.prepare(`UPDATE line_items SET normalized_name = 'Organic Bananas' WHERE id = ?`)
        .bind(lineItemId)
        .run(),
    ).resolves.toBeDefined();
  });
});

describe("golden_set.split is write-once", () => {
  async function insertGoldenSetRow(split: "train" | "val" | "test" | null): Promise<string> {
    const id = crypto.randomUUID();
    await DB.prepare(
      `INSERT INTO golden_set (id, raw_string, verdict, labeler, taxonomy_version, split)
       VALUES (?, 'ORG BANANAS', 'confirmed', 'labeler-1', '0.1.0', ?)`,
    )
      .bind(id, split)
      .run();
    return id;
  }

  it("rejects re-assigning split once it is set", async () => {
    const id = await insertGoldenSetRow("train");

    await expect(
      DB.prepare(`UPDATE golden_set SET split = 'test' WHERE id = ?`).bind(id).run(),
    ).rejects.toThrow(/write-once/);

    const row = await DB.prepare(`SELECT split FROM golden_set WHERE id = ?`)
      .bind(id)
      .first<{ split: string }>();
    expect(row?.split).toBe("train");
  });

  it("allows assigning split from NULL", async () => {
    const id = await insertGoldenSetRow(null);

    await expect(
      DB.prepare(`UPDATE golden_set SET split = 'val' WHERE id = ?`).bind(id).run(),
    ).resolves.toBeDefined();

    const row = await DB.prepare(`SELECT split FROM golden_set WHERE id = ?`)
      .bind(id)
      .first<{ split: string }>();
    expect(row?.split).toBe("val");
  });

  it("allows re-writing split to the same value it already holds", async () => {
    const id = await insertGoldenSetRow("train");

    await expect(
      DB.prepare(`UPDATE golden_set SET split = 'train' WHERE id = ?`).bind(id).run(),
    ).resolves.toBeDefined();
  });
});

describe("dates are ISO 8601, enforced by CHECK", () => {
  it("rejects datetime('now'), which is not ISO 8601", async () => {
    await expect(
      DB.prepare(`UPDATE receipts SET created_at = datetime('now') WHERE id = ?`)
        .bind(receiptId)
        .run(),
    ).rejects.toThrow();
  });

  it("accepts strftime('%Y-%m-%dT%H:%M:%fZ','now')", async () => {
    await expect(
      DB.prepare(
        `UPDATE receipts SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      )
        .bind(receiptId)
        .run(),
    ).resolves.toBeDefined();
  });

  it("defaults created_at to a valid ISO 8601 string on insert", async () => {
    const row = await DB.prepare(`SELECT created_at FROM receipts WHERE id = ?`)
      .bind(receiptId)
      .first<{
        created_at: string;
      }>();
    expect(row?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  });
});

describe("line_items embedding columns are all-or-nothing", () => {
  it("rejects an embedding with no embedding_model", async () => {
    await expect(
      DB.prepare(
        `INSERT INTO line_items (id, receipt_id, raw_text, taxonomy_version, embedding, dims)
         VALUES (?, ?, 'SOME ITEM', '0.1.0', X'00010203', 4)`,
      )
        .bind(crypto.randomUUID(), receiptId)
        .run(),
    ).rejects.toThrow();
  });

  it("accepts a row with all embedding columns NULL", async () => {
    await expect(
      DB.prepare(
        `INSERT INTO line_items (id, receipt_id, raw_text, taxonomy_version) VALUES (?, ?, 'SOME ITEM', '0.1.0')`,
      )
        .bind(crypto.randomUUID(), receiptId)
        .run(),
    ).resolves.toBeDefined();
  });

  it("accepts a fully-populated embedding block", async () => {
    await expect(
      DB.prepare(
        `INSERT INTO line_items (id, receipt_id, raw_text, taxonomy_version, embedding, embedding_model, embedding_version, dims)
         VALUES (?, ?, 'SOME ITEM', '0.1.0', X'00010203', 'bge-base', 'v1', 4)`,
      )
        .bind(crypto.randomUUID(), receiptId)
        .run(),
    ).resolves.toBeDefined();
  });
});

describe("receipt_sources.external_id is unique for idempotent re-syncs", () => {
  it("rejects a duplicate external_id", async () => {
    const externalId = "gmail-message-abc123";
    await DB.prepare(
      `INSERT INTO receipt_sources (id, receipt_id, source_id, external_id) VALUES (?, ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), receiptId, sourceId, externalId)
      .run();

    await expect(
      DB.prepare(
        `INSERT INTO receipt_sources (id, receipt_id, source_id, external_id) VALUES (?, ?, ?, ?)`,
      )
        .bind(crypto.randomUUID(), receiptId, sourceId, externalId)
        .run(),
    ).rejects.toThrow();
  });

  it("allows multiple rows with a NULL external_id", async () => {
    await DB.prepare(
      `INSERT INTO receipt_sources (id, receipt_id, source_id, external_id) VALUES (?, ?, ?, NULL)`,
    )
      .bind(crypto.randomUUID(), receiptId, sourceId)
      .run();

    await expect(
      DB.prepare(
        `INSERT INTO receipt_sources (id, receipt_id, source_id, external_id) VALUES (?, ?, ?, NULL)`,
      )
        .bind(crypto.randomUUID(), receiptId, sourceId)
        .run(),
    ).resolves.toBeDefined();
  });
});

describe("money is integer cents", () => {
  it("stores total_cents as an integer", async () => {
    const row = await DB.prepare(`SELECT total_cents FROM receipts WHERE id = ?`)
      .bind(receiptId)
      .first<{
        total_cents: number;
      }>();
    expect(row?.total_cents).toBe(1234);
    expect(Number.isInteger(row?.total_cents)).toBe(true);
  });
});
