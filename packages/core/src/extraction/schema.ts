/**
 * The extraction contract — one field-spec table, two consumers
 * (`toExtractionJsonSchema`, the tool input_schema handed to the model;
 * `parse.ts`, the parser that validates the model's output against the
 * same table). One table, two consumers: the TS-type/JSON-schema drift
 * class does not exist, because both are generated from — or checked
 * against — this table rather than hand-kept in sync.
 *
 * Money fields are named `_cents` and typed integer (AGENTS.md, Data
 * conventions #1) — the brief's shorthand (`unit_price`) is deliberately
 * not used here, because "integer cents in the extraction JSON" is what
 * makes this checkable against the D1 schema's `typeof(...) = 'integer'`
 * CHECKs (Review invariant 1).
 */

import type { TaxonomyCategory } from "../taxonomy.js";

export type FieldKind =
  | "cents"
  | "text"
  | "unit-interval"
  | "purchase-date"
  | "category-slug"
  | "quantity";

export interface FieldSpec {
  name: string;
  kind: FieldKind;
  nullable: boolean;
  description: string;
  /**
   * A JSON Schema `pattern` (regex source), enforced both in the
   * model-facing tool schema below and by `parse.ts`'s `checkFieldValue`
   * — only meaningful for `kind: "text"`. Round 2, finding 5: without
   * this, `payment_last4` had no constraint tighter than "is a string" on
   * either side, while `receipts.payment_last4`'s D1 CHECK requires
   * exactly four digits (`GLOB '[0-9][0-9][0-9][0-9]'`) — a model
   * returning `"****4242"` passed the extraction contract and only failed
   * at the database, deep inside `persistExtraction`.
   */
  pattern?: string;
}

/** Receipt-level fields — everything in `ExtractionResult` except
 * `line_items`, `schema_version`, and `taxonomy_version` (those three are
 * not model output: `schema_version`/`taxonomy_version` are stamped by
 * the caller, not asked of the model). */
export const RECEIPT_FIELDS: readonly FieldSpec[] = [
  {
    name: "merchant_raw",
    kind: "text",
    nullable: false,
    description:
      "The merchant name exactly as printed on the receipt — no title-casing, no trimming beyond the printed text.",
  },
  {
    name: "merchant_normalized",
    kind: "text",
    nullable: true,
    description:
      "A cleaned-up merchant name suitable for matching across receipts (drop store numbers, fix casing).",
  },
  {
    name: "store_location",
    kind: "text",
    nullable: true,
    description: "Store address or location line, if printed.",
  },
  {
    name: "purchased_at",
    kind: "purchase-date",
    nullable: true,
    description:
      "The purchase date, exactly as printed: a full ISO 8601 timestamp if a time is printed, otherwise a date-only YYYY-MM-DD. Never fabricate a time or timezone that was not printed.",
  },
  {
    name: "subtotal_cents",
    kind: "cents",
    nullable: true,
    description: "Subtotal before tax, in integer cents.",
  },
  {
    name: "tax_cents",
    kind: "cents",
    nullable: true,
    description: "Total tax, in integer cents.",
  },
  {
    name: "total_cents",
    kind: "cents",
    nullable: true,
    description: "The stated total, in integer cents.",
  },
  {
    name: "payment_last4",
    kind: "text",
    nullable: true,
    pattern: "^\\d{4}$",
    description: "Last 4 digits of the payment card, if printed.",
  },
];

/** Line-item fields — one `ExtractedLineItem`. */
export const LINE_ITEM_FIELDS: readonly FieldSpec[] = [
  {
    name: "raw_text",
    kind: "text",
    nullable: false,
    description:
      "The line exactly as printed — exact case, no title-casing, no trimming, untrimmed. This is evidence, not copy.",
  },
  {
    name: "normalized_name",
    kind: "text",
    nullable: true,
    description: "A cleaned-up, human-readable item name.",
  },
  {
    name: "qty",
    kind: "quantity",
    nullable: true,
    description: "Quantity purchased, if printed (e.g. 1.24 for a weighed item).",
  },
  {
    name: "unit_price_cents",
    kind: "cents",
    nullable: true,
    description: "Per-unit price, in integer cents, if printed.",
  },
  {
    name: "extended_price_cents",
    kind: "cents",
    nullable: true,
    description:
      "The line's total contribution to the receipt, in integer cents — this is the field the checksum sums.",
  },
  {
    name: "discount_cents",
    kind: "cents",
    nullable: true,
    description:
      "A discount applied to this line, in integer cents. Informational only — never summed into the checksum.",
  },
  {
    name: "category",
    kind: "category-slug",
    nullable: false,
    description:
      "The taxonomy category slug this line belongs to. Use `fees-adjustments` for CRV/bag fees/tips/delivery/standalone coupons; use `other` only when nothing else fits.",
  },
  {
    name: "subcategory",
    kind: "text",
    nullable: true,
    description:
      "The taxonomy subcategory slug, if the chosen category has subcategories and one clearly applies.",
  },
  {
    name: "confidence",
    kind: "unit-interval",
    nullable: true,
    description: "The model's confidence in this line's category, 0 to 1.",
  },
];

function fieldSchema(
  field: FieldSpec,
  taxonomy: readonly TaxonomyCategory[],
): Record<string, unknown> {
  let base: Record<string, unknown>;
  switch (field.kind) {
    case "cents":
      base = { type: "integer" };
      break;
    case "text":
      base = { type: "string" };
      break;
    case "unit-interval":
      base = { type: "number", minimum: 0, maximum: 1 };
      break;
    case "purchase-date":
      base = { type: "string" };
      break;
    case "quantity":
      base = { type: "number" };
      break;
    case "category-slug":
      base = { type: "string", enum: taxonomy.map((c) => c.slug) };
      break;
  }
  base.description = field.description;
  if (field.pattern) {
    base.pattern = field.pattern;
  }
  if (field.nullable) {
    base.type = Array.isArray(base.type) ? base.type : [base.type as string, "null"];
  }
  return base;
}

function objectSchema(
  fields: readonly FieldSpec[],
  taxonomy: readonly TaxonomyCategory[],
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const field of fields) {
    properties[field.name] = fieldSchema(field, taxonomy);
    if (!field.nullable) required.push(field.name);
  }
  return { type: "object", properties, required };
}

/** The JSON Schema handed to the model as a tool `input_schema`, generated
 * from the field-spec tables above plus the taxonomy's enum. */
export function toExtractionJsonSchema(
  taxonomy: readonly TaxonomyCategory[],
): Record<string, unknown> {
  const receiptSchema = objectSchema(RECEIPT_FIELDS, taxonomy);
  const lineItemSchema = objectSchema(LINE_ITEM_FIELDS, taxonomy);
  return {
    type: "object",
    properties: {
      ...(receiptSchema.properties as Record<string, unknown>),
      line_items: {
        type: "array",
        items: lineItemSchema,
      },
    },
    required: [...(receiptSchema.required as string[]), "line_items"],
  };
}
