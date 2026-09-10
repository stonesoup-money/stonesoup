import { describe, expect, it } from "vitest";
import { TAXONOMY } from "../taxonomy.js";
import { toExtractionJsonSchema } from "./schema.js";

describe("toExtractionJsonSchema", () => {
  const schema = toExtractionJsonSchema(TAXONOMY);

  it("requires merchant_raw and line_items", () => {
    const required = schema.required as string[];
    expect(required).toContain("merchant_raw");
    expect(required).toContain("line_items");
  });

  it("does not require nullable receipt fields", () => {
    const required = schema.required as string[];
    expect(required).not.toContain("merchant_normalized");
    expect(required).not.toContain("total_cents");
  });

  it("constrains line_items[].category to the taxonomy enum", () => {
    const lineItems = (schema.properties as Record<string, unknown>).line_items as Record<
      string,
      unknown
    >;
    const items = lineItems.items as Record<string, unknown>;
    const properties = items.properties as Record<string, unknown>;
    const category = properties.category as Record<string, unknown>;
    expect(category.enum).toEqual(TAXONOMY.map((c) => c.slug));
  });

  it("types every *_cents field as integer", () => {
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    expect(properties.total_cents?.type).toEqual(["integer", "null"]);
    expect(properties.subtotal_cents?.type).toEqual(["integer", "null"]);
  });
});
