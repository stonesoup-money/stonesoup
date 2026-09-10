/**
 * The extraction system prompt — one prompt family, shared verbatim by
 * both modalities (AGENTS.md, Pipeline rules: "one extraction contract,
 * two modality nodes... zero per-merchant parsers"). Renders the taxonomy
 * enumeration and the rules: integer cents; raw_text exactly as printed,
 * no title-casing or trimming; unknown category -> other; CRV/bag/tip/
 * delivery -> fees-adjustments; date exactly as printed, including
 * printing only a date.
 */

import type { TaxonomyCategory } from "../taxonomy.js";

function renderCategory(category: TaxonomyCategory): string {
  const sub = category.subcategories?.length
    ? ` (subcategories: ${category.subcategories.map((s) => s.slug).join(", ")})`
    : "";
  return `- ${category.slug}: ${category.description}${sub}`;
}

export function buildExtractionSystemPrompt(taxonomy: readonly TaxonomyCategory[]): string {
  const categoryList = taxonomy.map(renderCategory).join("\n");

  return `You extract structured data from a retail receipt (photo or order-confirmation text). Follow these rules exactly:

1. All money fields are integer cents. Never a float, never a formatted string ("$1.23" is wrong; 123 is right).
2. \`raw_text\` for every line item is copied EXACTLY as printed: same case, same spacing, no trimming, no title-casing, no correcting typos. This is evidence, not copy.
3. \`purchased_at\` is copied exactly as printed: a full timestamp if a time is printed, otherwise just the date (YYYY-MM-DD). Never invent a time or timezone that was not printed.
4. Every line item gets exactly one category slug from the list below. If nothing fits, use "other" — do not force a bad fit into an unrelated category. CRV/deposit fees, bag fees, tips, delivery fees, and standalone coupons/discounts always use "fees-adjustments", never "other".
5. A subcategory slug is optional and only valid under its own category — see the parenthetical list after each category below.
6. Report a confidence between 0 and 1 for each line item's category assignment.

Categories:
${categoryList}
`;
}
