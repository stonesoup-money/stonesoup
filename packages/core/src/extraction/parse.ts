/**
 * `parseExtractionResult` — never throws on model output (AGENTS.md,
 * Pipeline rules: "a malformed extraction is a receipt routed to review,
 * not a 500"). Validates against the same field-spec tables schema.ts
 * generates the model-facing JSON Schema from, plus the taxonomy enum
 * (Review invariant 9: an unknown category slug is rejected, never
 * silently accepted). Rejects a float in a cents field, confidence
 * outside 0–1, an unknown category slug, a missing `raw_text`, and a
 * `purchased_at` matching neither accepted shape.
 */

import { isPurchaseDate } from "../dates.js";
import { isValidCents } from "../money.js";
import { isCategorySlug, isSubcategorySlug } from "../taxonomy.js";
import type { FieldSpec } from "./schema.js";
import { LINE_ITEM_FIELDS, RECEIPT_FIELDS } from "./schema.js";
import type { ExtractedLineItem, ExtractionResult } from "./types.js";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkFieldValue(field: FieldSpec, value: unknown, errors: string[], path: string): void {
  const label = path ? `${path}.${field.name}` : field.name;
  if (value === null || value === undefined) {
    if (!field.nullable) errors.push(`${label} is required and must not be null`);
    return;
  }
  switch (field.kind) {
    case "cents":
      if (!isValidCents(value))
        errors.push(`${label} must be an integer number of cents, got ${JSON.stringify(value)}`);
      return;
    case "text":
      if (typeof value !== "string") {
        errors.push(`${label} must be a string, got ${JSON.stringify(value)}`);
      } else if (field.pattern && !new RegExp(field.pattern).test(value)) {
        // Round 2, finding 5: closes the gap between the extraction
        // contract and a D1 CHECK stricter than a bare "text" field (e.g.
        // `payment_last4` requires exactly four digits) — see schema.ts's
        // `FieldSpec.pattern`.
        errors.push(`${label} must match ${field.pattern}, got ${JSON.stringify(value)}`);
      }
      return;
    case "unit-interval":
      if (typeof value !== "number" || value < 0 || value > 1) {
        errors.push(`${label} must be a number between 0 and 1, got ${JSON.stringify(value)}`);
      }
      return;
    case "purchase-date":
      if (!isPurchaseDate(value)) {
        errors.push(
          `${label} must be an ISO 8601 datetime or a date-only YYYY-MM-DD string, got ${JSON.stringify(value)}`,
        );
      }
      return;
    case "category-slug":
      if (!isCategorySlug(value)) {
        errors.push(`${label} is not a known taxonomy category slug: ${JSON.stringify(value)}`);
      }
      return;
    case "quantity":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        errors.push(`${label} must be a finite number, got ${JSON.stringify(value)}`);
      }
      return;
  }
}

function parseLineItem(value: unknown, index: number, errors: string[]): ExtractedLineItem | null {
  const path = `line_items[${index}]`;
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return null;
  }
  for (const field of LINE_ITEM_FIELDS) {
    checkFieldValue(field, value[field.name], errors, path);
  }
  const category = value.category;
  const subcategory = value.subcategory;
  if (
    typeof category === "string" &&
    isCategorySlug(category) &&
    subcategory !== null &&
    subcategory !== undefined &&
    !isSubcategorySlug(category, subcategory)
  ) {
    errors.push(
      `${path}.subcategory ${JSON.stringify(subcategory)} is not a subcategory of category "${category}"`,
    );
  }
  if (errors.length > 0) return null;
  return {
    raw_text: value.raw_text as string,
    normalized_name: (value.normalized_name as string | null) ?? null,
    qty: (value.qty as number | null) ?? null,
    unit_price_cents: (value.unit_price_cents as number | null) ?? null,
    extended_price_cents: (value.extended_price_cents as number | null) ?? null,
    discount_cents: (value.discount_cents as number | null) ?? null,
    category: category as string,
    subcategory: (subcategory as string | null) ?? null,
    confidence: (value.confidence as number | null) ?? null,
  };
}

/**
 * Parses raw model tool-call input against the extraction contract.
 * `schemaVersion` / `taxonomyVersion` are stamped by the caller (they are
 * not asked of the model — see schema.ts) and are not validated here
 * beyond being present on the returned value.
 */
export function parseExtractionResult(
  value: unknown,
  meta: { schemaVersion: number; taxonomyVersion: string },
): ParseResult<ExtractionResult> {
  const errors: string[] = [];

  if (!isPlainObject(value)) {
    return { ok: false, errors: ["extraction result must be an object"] };
  }

  for (const field of RECEIPT_FIELDS) {
    checkFieldValue(field, value[field.name], errors, "");
  }

  const rawLineItems = value.line_items;
  if (!Array.isArray(rawLineItems)) {
    errors.push("line_items must be an array");
    return { ok: false, errors };
  }

  const lineItems: ExtractedLineItem[] = [];
  for (let i = 0; i < rawLineItems.length; i++) {
    const itemErrors: string[] = [];
    const parsed = parseLineItem(rawLineItems[i], i, itemErrors);
    errors.push(...itemErrors);
    if (parsed) lineItems.push(parsed);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      schema_version: meta.schemaVersion,
      taxonomy_version: meta.taxonomyVersion,
      merchant_raw: value.merchant_raw as string,
      merchant_normalized: (value.merchant_normalized as string | null) ?? null,
      store_location: (value.store_location as string | null) ?? null,
      purchased_at: (value.purchased_at as string | null) ?? null,
      subtotal_cents: (value.subtotal_cents as number | null) ?? null,
      tax_cents: (value.tax_cents as number | null) ?? null,
      total_cents: (value.total_cents as number | null) ?? null,
      payment_last4: (value.payment_last4 as string | null) ?? null,
      line_items: lineItems,
    },
  };
}
