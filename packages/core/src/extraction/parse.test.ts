import { describe, expect, it } from "vitest";
import { parseExtractionResult } from "./parse.js";

const META = { schemaVersion: 1, taxonomyVersion: "0.1.0" };

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    merchant_raw: "TRADER JOE'S #123",
    merchant_normalized: "Trader Joe's",
    store_location: null,
    purchased_at: "2026-09-10",
    subtotal_cents: 500,
    tax_cents: 44,
    total_cents: 544,
    payment_last4: "1234",
    line_items: [
      {
        raw_text: "ORG BANANAS  1.24 LB @ .79/LB",
        normalized_name: "Organic Bananas",
        qty: 1.24,
        unit_price_cents: 79,
        extended_price_cents: 98,
        discount_cents: null,
        category: "produce",
        subcategory: null,
        confidence: 0.92,
      },
    ],
    ...overrides,
  };
}

/** Extracts the first line item as a mutable record — a type assertion
 * (`as`), not a non-null assertion (`!`), so it stays clear of
 * `lint/style/noNonNullAssertion` while still being exactly as unsafe as
 * these tests intend (the fixture above always has exactly one item). */
function firstLineItem(payload: { line_items: unknown }): Record<string, unknown> {
  return (payload.line_items as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
}

describe("parseExtractionResult — happy path", () => {
  it("parses a valid payload and stamps schema/taxonomy version", () => {
    const result = parseExtractionResult(validPayload(), META);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.schema_version).toBe(1);
    expect(result.value.taxonomy_version).toBe("0.1.0");
    expect(result.value.merchant_raw).toBe("TRADER JOE'S #123");
    expect(result.value.line_items).toHaveLength(1);
  });

  it("accepts a full ISO timestamp for purchased_at", () => {
    const result = parseExtractionResult(
      validPayload({ purchased_at: "2026-09-10T12:00:00.000Z" }),
      META,
    );
    expect(result.ok).toBe(true);
  });

  it("accepts a null total_cents", () => {
    const result = parseExtractionResult(validPayload({ total_cents: null }), META);
    expect(result.ok).toBe(true);
  });
});

describe("parseExtractionResult — never throws, rejects with errors", () => {
  it("rejects a non-object payload", () => {
    const result = parseExtractionResult("not an object", META);
    expect(result.ok).toBe(false);
  });

  it("rejects a missing merchant_raw", () => {
    const payload: Record<string, unknown> = validPayload();
    delete payload.merchant_raw;
    const result = parseExtractionResult(payload, META);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.errors.join(" ")).toMatch(/merchant_raw/);
  });

  it("rejects a float in a cents field", () => {
    const result = parseExtractionResult(validPayload({ total_cents: 5.44 }), META);
    expect(result.ok).toBe(false);
  });

  it("rejects confidence outside 0-1", () => {
    const payload = validPayload();
    firstLineItem(payload).confidence = 1.5;
    const result = parseExtractionResult(payload, META);
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown category slug", () => {
    const payload = validPayload();
    firstLineItem(payload).category = "not-a-real-category";
    const result = parseExtractionResult(payload, META);
    expect(result.ok).toBe(false);
  });

  it("rejects a purchased_at matching neither accepted shape", () => {
    const result = parseExtractionResult(validPayload({ purchased_at: "09/10/2026" }), META);
    expect(result.ok).toBe(false);
  });

  it("rejects a missing line_items.raw_text", () => {
    const payload = validPayload();
    delete firstLineItem(payload).raw_text;
    const result = parseExtractionResult(payload, META);
    expect(result.ok).toBe(false);
  });

  it("rejects a subcategory that does not belong to the chosen category", () => {
    const payload = validPayload();
    const item = firstLineItem(payload);
    item.category = "produce";
    item.subcategory = "beer";
    const result = parseExtractionResult(payload, META);
    expect(result.ok).toBe(false);
  });

  it("rejects line_items not being an array", () => {
    const result = parseExtractionResult(validPayload({ line_items: "nope" }), META);
    expect(result.ok).toBe(false);
  });

  // Round 2, finding 5: closes the gap between the extraction contract
  // and receipts.payment_last4's D1 CHECK (exactly four digits) — a model
  // returning a masked card number used to pass this parser and only fail
  // at the database, deep inside persistExtraction.
  it("rejects a payment_last4 that is not exactly four digits", () => {
    const result = parseExtractionResult(validPayload({ payment_last4: "****4242" }), META);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.errors.join(" ")).toMatch(/payment_last4/);
  });

  it("accepts a null payment_last4", () => {
    const result = parseExtractionResult(validPayload({ payment_last4: null }), META);
    expect(result.ok).toBe(true);
  });
});
