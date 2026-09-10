import { describe, expect, it } from "vitest";
import {
  isCategorySlug,
  isSubcategorySlug,
  pickerCategorySlugs,
  subcategoriesOf,
  TAXONOMY,
  TAXONOMY_STATUS,
} from "./taxonomy.js";

describe("taxonomy shape (AGENTS.md: 22 first-level categories, ~17 second-level slugs under five of them)", () => {
  it("is provisional", () => {
    expect(TAXONOMY_STATUS).toBe("provisional");
  });

  it("has 22 first-level categories", () => {
    expect(TAXONOMY.length).toBe(22);
  });

  it("has unique slugs", () => {
    const slugs = TAXONOMY.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("has fees-adjustments and other", () => {
    expect(isCategorySlug("fees-adjustments")).toBe(true);
    expect(isCategorySlug("other")).toBe(true);
  });

  it("has subcategories under exactly five categories totaling ~17", () => {
    const withSub = TAXONOMY.filter((c) => (c.subcategories?.length ?? 0) > 0);
    expect(withSub.length).toBe(5);
    const total = withSub.reduce((sum, c) => sum + (c.subcategories?.length ?? 0), 0);
    expect(total).toBe(17);
  });
});

describe("isCategorySlug / isSubcategorySlug", () => {
  it("rejects an unknown category slug", () => {
    expect(isCategorySlug("not-a-real-slug")).toBe(false);
  });

  it("rejects a subcategory that belongs to a different category", () => {
    expect(isSubcategorySlug("pantry", "beer")).toBe(false);
  });

  it("accepts a subcategory that belongs to its category", () => {
    expect(isSubcategorySlug("alcohol", "beer")).toBe(true);
  });

  it("subcategoriesOf returns [] for a category with none", () => {
    expect(subcategoriesOf("produce")).toEqual([]);
  });
});

describe("pickerCategorySlugs", () => {
  it("falls back to the seed order with no usage history", () => {
    const slugs = pickerCategorySlugs({});
    expect(slugs.length).toBeGreaterThan(0);
    expect(slugs.every((s) => isCategorySlug(s))).toBe(true);
  });

  it("orders by usage count, descending", () => {
    const slugs = pickerCategorySlugs({ produce: 1, pantry: 10, dairy_eggs: 5 } as never);
    // "dairy_eggs" isn't a real slug (underscore, not hyphen) so it's
    // filtered out — pantry (10) must lead over produce (1).
    expect(slugs[0]).toBe("pantry");
  });

  it("only the first min(n, 9) slugs can carry a digit key — documented, not enforced here (the caller's job)", () => {
    const slugs = pickerCategorySlugs({});
    expect(slugs.length).toBeGreaterThanOrEqual(9);
  });
});
