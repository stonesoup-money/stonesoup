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

// Review round 1, finding 1: `INSERT OR REPLACE` is DELETE+INSERT, not
// UPDATE — the BEFORE UPDATE triggers above never see it, and the reviewer
// proved it silently deletes every line_items/receipt_sources row for a
// receipt. These reproduce the exact repro from the review and lock in
// that `UPDATE OR IGNORE` and upsert `DO UPDATE` still behave correctly.
describe("INSERT OR REPLACE cannot bypass the protected tables (review round 1, finding 1)", () => {
  it("blocks the reviewer's exact repro and leaves the receipt's line items intact", async () => {
    // Reviewer's reproduction, verbatim: before, 1 line item; naively,
    // after, 0 — because REPLACE deletes the receipt row (cascading to
    // line_items via ON DELETE CASCADE) and reinserts it from scratch.
    await expect(
      DB.prepare(
        `INSERT OR REPLACE INTO receipts (id, merchant_raw, total_cents) VALUES (?, 'TRADER JOES', 9999)`,
      )
        .bind(receiptId)
        .run(),
    ).rejects.toThrow();

    const lineItems = await DB.prepare(`SELECT COUNT(*) as c FROM line_items WHERE receipt_id = ?`)
      .bind(receiptId)
      .first<{ c: number }>();
    expect(lineItems?.c).toBe(1);

    const receipt = await DB.prepare(`SELECT merchant_raw, total_cents FROM receipts WHERE id = ?`)
      .bind(receiptId)
      .first<{ merchant_raw: string; total_cents: number }>();
    expect(receipt?.merchant_raw).toBe("TRADER JOE'S #123");
    expect(receipt?.total_cents).toBe(1234);
  });

  it("blocks INSERT OR REPLACE on line_items and leaves raw_text intact", async () => {
    await expect(
      DB.prepare(
        `INSERT OR REPLACE INTO line_items (id, receipt_id, raw_text, taxonomy_version) VALUES (?, ?, 'REWRITTEN', '0.1.0')`,
      )
        .bind(lineItemId, receiptId)
        .run(),
    ).rejects.toThrow();

    const row = await DB.prepare(`SELECT raw_text FROM line_items WHERE id = ?`)
      .bind(lineItemId)
      .first<{ raw_text: string }>();
    expect(row?.raw_text).toBe("ORG BANANAS  1.24 LB @ .79/LB");
  });

  it("blocks INSERT OR REPLACE on golden_set and leaves a written split intact", async () => {
    const id = crypto.randomUUID();
    await DB.prepare(
      `INSERT INTO golden_set (id, raw_string, verdict, labeler, taxonomy_version, split)
       VALUES (?, 'ORG BANANAS', 'confirmed', 'labeler-1', '0.1.0', 'train')`,
    )
      .bind(id)
      .run();

    await expect(
      DB.prepare(
        `INSERT OR REPLACE INTO golden_set (id, raw_string, verdict, labeler, taxonomy_version, split)
         VALUES (?, 'ORG BANANAS', 'confirmed', 'labeler-1', '0.1.0', 'test')`,
      )
        .bind(id)
        .run(),
    ).rejects.toThrow();

    const row = await DB.prepare(`SELECT split FROM golden_set WHERE id = ?`)
      .bind(id)
      .first<{ split: string }>();
    expect(row?.split).toBe("train");
  });

  it("UPDATE OR IGNORE still respects raw_text immutability (lock-in, not a regression target)", async () => {
    // OR IGNORE's conflict resolution applies to constraint violations
    // (NOT NULL, UNIQUE, CHECK, FK) — not to an explicit RAISE(ABORT) from
    // a trigger, so this must still fail loudly, not silently no-op.
    await expect(
      DB.prepare(`UPDATE OR IGNORE line_items SET raw_text = 'CORRECTED TEXT' WHERE id = ?`)
        .bind(lineItemId)
        .run(),
    ).rejects.toThrow(/immutable/);

    const row = await DB.prepare(`SELECT raw_text FROM line_items WHERE id = ?`)
      .bind(lineItemId)
      .first<{ raw_text: string }>();
    expect(row?.raw_text).toBe("ORG BANANAS  1.24 LB @ .79/LB");
  });

  it("upsert (ON CONFLICT DO UPDATE) still respects raw_text immutability (lock-in)", async () => {
    await expect(
      DB.prepare(
        `INSERT INTO line_items (id, receipt_id, raw_text, taxonomy_version) VALUES (?, ?, 'CORRECTED TEXT', '0.1.0')
         ON CONFLICT(id) DO UPDATE SET raw_text = excluded.raw_text`,
      )
        .bind(lineItemId, receiptId)
        .run(),
    ).rejects.toThrow(/immutable/);

    const row = await DB.prepare(`SELECT raw_text FROM line_items WHERE id = ?`)
      .bind(lineItemId)
      .first<{ raw_text: string }>();
    expect(row?.raw_text).toBe("ORG BANANAS  1.24 LB @ .79/LB");
  });

  it("upsert (ON CONFLICT DO UPDATE) still works for a non-protected column (lock-in)", async () => {
    await expect(
      DB.prepare(
        `INSERT INTO line_items (id, receipt_id, raw_text, taxonomy_version, normalized_name)
         VALUES (?, ?, 'ORG BANANAS  1.24 LB @ .79/LB', '0.1.0', 'Organic Bananas')
         ON CONFLICT(id) DO UPDATE SET normalized_name = excluded.normalized_name`,
      )
        .bind(lineItemId, receiptId)
        .run(),
    ).resolves.toBeDefined();

    const row = await DB.prepare(`SELECT normalized_name FROM line_items WHERE id = ?`)
      .bind(lineItemId)
      .first<{ normalized_name: string }>();
    expect(row?.normalized_name).toBe("Organic Bananas");
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

describe("golden_set constraints match its review_queue source (review round 1, finding 11)", () => {
  async function insertGoldenSetRow(overrides: Partial<Record<string, string>>): Promise<void> {
    const id = crypto.randomUUID();
    const base = {
      raw_string: "ORG BANANAS",
      verdict: "confirmed",
      labeler: "labeler-1",
      taxonomy_version: "0.1.0",
    };
    const row = { ...base, ...overrides };
    await DB.prepare(
      `INSERT INTO golden_set (id, raw_string, verdict, labeler, taxonomy_version, routing_reason, model_confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        row.raw_string,
        row.verdict,
        row.labeler,
        row.taxonomy_version,
        overrides.routing_reason ?? null,
        overrides.model_confidence ?? null,
      )
      .run();
  }

  it("rejects a verdict outside the enum", async () => {
    await expect(insertGoldenSetRow({ verdict: "maybe" })).rejects.toThrow();
  });

  it("rejects a routing_reason outside the enum", async () => {
    await expect(insertGoldenSetRow({ routing_reason: "because" })).rejects.toThrow();
  });

  it("rejects a model_confidence outside 0-1", async () => {
    await expect(insertGoldenSetRow({ model_confidence: "1.5" })).rejects.toThrow();
  });

  it("accepts a valid routing_reason and model_confidence", async () => {
    await expect(
      insertGoldenSetRow({ routing_reason: "low_confidence", model_confidence: "0.42" }),
    ).resolves.toBeUndefined();
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

  it("rejects a date CHECK bypass that the loose GLOB used to allow (review round 1, finding 15)", async () => {
    await expect(
      DB.prepare(`UPDATE receipts SET extracted_at = '2026-09-10TZ' WHERE id = ?`)
        .bind(receiptId)
        .run(),
    ).rejects.toThrow();

    await expect(
      DB.prepare(`UPDATE receipts SET extracted_at = 'abcd-ef-ghTgarbageZ' WHERE id = ?`)
        .bind(receiptId)
        .run(),
    ).rejects.toThrow();
  });
});

// Review round 1, finding 4: a receipt prints a local date, never a time
// or a timezone. purchased_at must accept that date exactly as printed,
// not force a fabricated time onto it.
describe("purchased_at accepts a full timestamp or a date-only value (review round 1, finding 4)", () => {
  it("accepts a date-only YYYY-MM-DD value — the reviewer's exact repro", async () => {
    await expect(
      DB.prepare(`UPDATE receipts SET purchased_at = '2026-09-10' WHERE id = ?`)
        .bind(receiptId)
        .run(),
    ).resolves.toBeDefined();

    const row = await DB.prepare(`SELECT purchased_at FROM receipts WHERE id = ?`)
      .bind(receiptId)
      .first<{ purchased_at: string }>();
    expect(row?.purchased_at).toBe("2026-09-10");
  });

  it("accepts a full ISO 8601 timestamp", async () => {
    await expect(
      DB.prepare(`UPDATE receipts SET purchased_at = '2026-09-10T12:34:56.000Z' WHERE id = ?`)
        .bind(receiptId)
        .run(),
    ).resolves.toBeDefined();
  });

  it("rejects a value that is neither shape", async () => {
    await expect(
      DB.prepare(`UPDATE receipts SET purchased_at = '09/10/2026' WHERE id = ?`)
        .bind(receiptId)
        .run(),
    ).rejects.toThrow();
  });

  it("rejects datetime('now'), which matches neither accepted shape", async () => {
    await expect(
      DB.prepare(`UPDATE receipts SET purchased_at = datetime('now') WHERE id = ?`)
        .bind(receiptId)
        .run(),
    ).rejects.toThrow();
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

  it("rejects an embedding with embedding_version NULL but everything else set (review round 1, finding 5)", async () => {
    await expect(
      DB.prepare(
        `INSERT INTO line_items (id, receipt_id, raw_text, taxonomy_version, embedding, embedding_model, dims)
         VALUES (?, ?, 'SOME ITEM', '0.1.0', X'00010203', 'bge-base', 4)`,
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

// Review round 1, findings 2 and 3: the old version of this test inserted
// 1234, read back 1234, and asserted Number.isInteger on a value it chose
// itself — it would have passed identically against `total_cents REAL`.
// These attempt an actual non-integer write and assert the CHECK rejects
// it, on every money column in the schema.
describe("money is structurally integer cents (review round 1, findings 2 and 3)", () => {
  const moneyColumns: Array<["receipts" | "line_items", string]> = [
    ["receipts", "subtotal_cents"],
    ["receipts", "tax_cents"],
    ["receipts", "total_cents"],
    ["receipts", "checksum_delta_cents"],
    ["line_items", "unit_price_cents"],
    ["line_items", "extended_price_cents"],
    ["line_items", "discount_cents"],
  ];

  it.each(moneyColumns)(
    "rejects a non-integer write to %s.%s — the reviewer's exact repro shape",
    async (table, column) => {
      const id = table === "receipts" ? receiptId : lineItemId;
      await expect(
        DB.prepare(`UPDATE ${table} SET ${column} = 12.34 WHERE id = ?`).bind(id).run(),
      ).rejects.toThrow();
    },
  );

  it("still accepts a genuine integer write and reads it back unchanged", async () => {
    await expect(
      DB.prepare(`UPDATE receipts SET total_cents = 500 WHERE id = ?`).bind(receiptId).run(),
    ).resolves.toBeDefined();

    const row = await DB.prepare(`SELECT total_cents FROM receipts WHERE id = ?`)
      .bind(receiptId)
      .first<{ total_cents: number }>();
    expect(row?.total_cents).toBe(500);
    expect(Number.isInteger(row?.total_cents)).toBe(true);
  });
});

// Review round 1, finding 17: no test asserted FK enforcement, cascade
// behaviour, or the absence of receipts.source_id (this PR's one
// deliberate departure from the brief's literal text).
describe("foreign keys are enforced and cascade in D1 (review round 1, finding 17)", () => {
  it("rejects a line_items insert referencing a non-existent receipt", async () => {
    await expect(
      DB.prepare(
        `INSERT INTO line_items (id, receipt_id, raw_text, taxonomy_version) VALUES (?, ?, 'ORPHAN', '0.1.0')`,
      )
        .bind(crypto.randomUUID(), crypto.randomUUID())
        .run(),
    ).rejects.toThrow();
  });

  it("cascades a sources delete to its receipt_sources rows", async () => {
    const receiptSourceId = crypto.randomUUID();
    await DB.prepare(
      `INSERT INTO receipt_sources (id, receipt_id, source_id, external_id) VALUES (?, ?, ?, ?)`,
    )
      .bind(receiptSourceId, receiptId, sourceId, "gmail-msg-cascade-test")
      .run();

    await DB.prepare(`DELETE FROM sources WHERE id = ?`).bind(sourceId).run();

    const row = await DB.prepare(`SELECT id FROM receipt_sources WHERE id = ?`)
      .bind(receiptSourceId)
      .first();
    expect(row).toBeNull();
  });

  it("receipts has no source_id column — STON-16's accepted resolution, not the brief's literal text", async () => {
    const result = await DB.prepare(`PRAGMA table_info(receipts)`).all<{ name: string }>();
    const names = result.results.map((c) => c.name);
    expect(names).not.toContain("source_id");
  });
});
