/**
 * The provisional taxonomy (AGENTS.md, Taxonomy; STON-16). Two groups —
 * Food & drink, Everything else — 22 first-level categories, ~17
 * second-level slugs under five of them (pantry 5, beverages 4, alcohol 3,
 * household 3, health-wellness 2). Slugs are permanent IDs: additive-only,
 * never renamed or repurposed (Review invariant 9).
 *
 * `fees-adjustments` catches non-product lines (CRV, bag fees, tips,
 * delivery, standalone coupons) — without it every real receipt fails
 * checksum (AGENTS.md). `other` is instrumentation, not a catch-all to
 * widen: its usage rate signals a taxonomy gap.
 *
 * This module is what `extraction/schema.ts`'s JSON Schema `category` enum
 * is generated from and what `extraction/prompt.ts` renders — prompt and
 * schema cannot disagree because both read this one table.
 */

export const TAXONOMY_STATUS = "provisional" as const;

export interface TaxonomyCategory {
  slug: string;
  label: string;
  group: "food-drink" | "everything-else";
  /** One-line definition, rendered into the extraction prompt. */
  description: string;
  subcategories?: readonly TaxonomySubcategory[];
}

export interface TaxonomySubcategory {
  slug: string;
  label: string;
  description: string;
}

export const TAXONOMY: readonly TaxonomyCategory[] = [
  // --- Food & drink ---------------------------------------------------
  {
    slug: "produce",
    label: "Produce",
    group: "food-drink",
    description: "Fresh fruits and vegetables.",
  },
  {
    slug: "meat-seafood",
    label: "Meat & seafood",
    group: "food-drink",
    description: "Fresh or frozen meat, poultry, and seafood.",
  },
  {
    slug: "dairy-eggs",
    label: "Dairy & eggs",
    group: "food-drink",
    description: "Milk, cheese, yogurt, butter, and eggs.",
  },
  {
    slug: "bakery",
    label: "Bakery",
    group: "food-drink",
    description: "Bread, pastries, and other baked goods.",
  },
  {
    slug: "frozen",
    label: "Frozen",
    group: "food-drink",
    description: "Frozen prepared foods, not otherwise categorized.",
  },
  {
    slug: "pantry",
    label: "Pantry",
    group: "food-drink",
    description: "Shelf-stable staples and dry goods.",
    subcategories: [
      { slug: "grains-pasta", label: "Grains & pasta", description: "Rice, pasta, flour." },
      { slug: "canned-jarred", label: "Canned & jarred", description: "Canned and jarred goods." },
      {
        slug: "condiments-sauces",
        label: "Condiments & sauces",
        description: "Condiments, sauces, dressings.",
      },
      { slug: "baking", label: "Baking", description: "Baking ingredients and mixes." },
      { slug: "snacks", label: "Snacks", description: "Chips, crackers, and other snack food." },
    ],
  },
  {
    slug: "beverages",
    label: "Beverages",
    group: "food-drink",
    description: "Non-alcoholic drinks.",
    subcategories: [
      { slug: "coffee-tea", label: "Coffee & tea", description: "Coffee and tea." },
      {
        slug: "soda-juice",
        label: "Soda & juice",
        description: "Soda, juice, and other sweetened drinks.",
      },
      { slug: "water", label: "Water", description: "Bottled and sparkling water." },
      {
        slug: "other-beverages",
        label: "Other beverages",
        description: "Non-alcoholic drinks not otherwise listed.",
      },
    ],
  },
  {
    slug: "alcohol",
    label: "Alcohol",
    group: "food-drink",
    description: "Beer, wine, and spirits.",
    subcategories: [
      { slug: "beer", label: "Beer", description: "Beer and cider." },
      { slug: "wine", label: "Wine", description: "Wine." },
      { slug: "spirits", label: "Spirits", description: "Distilled spirits." },
    ],
  },
  {
    slug: "prepared-deli",
    label: "Prepared & deli",
    group: "food-drink",
    description: "Ready-to-eat deli and prepared foods.",
  },
  {
    slug: "restaurant-takeout",
    label: "Restaurant & takeout",
    group: "food-drink",
    description: "Meals eaten out or ordered for delivery.",
  },
  // --- Everything else -------------------------------------------------
  {
    slug: "household",
    label: "Household",
    group: "everything-else",
    description: "Household supplies and goods.",
    subcategories: [
      { slug: "cleaning", label: "Cleaning", description: "Cleaning supplies." },
      {
        slug: "paper-goods",
        label: "Paper goods",
        description: "Paper towels, tissues, toilet paper.",
      },
      {
        slug: "home-goods",
        label: "Home goods",
        description: "Kitchenware, linens, and other home goods.",
      },
    ],
  },
  {
    slug: "health-wellness",
    label: "Health & wellness",
    group: "everything-else",
    description: "Health, wellness, and pharmacy items.",
    subcategories: [
      {
        slug: "otc-medication",
        label: "OTC medication",
        description: "Over-the-counter medication.",
      },
      {
        slug: "personal-care",
        label: "Personal care",
        description: "Personal care and hygiene products.",
      },
    ],
  },
  {
    slug: "baby-kids",
    label: "Baby & kids",
    group: "everything-else",
    description: "Baby and children's products.",
  },
  {
    slug: "pet",
    label: "Pet",
    group: "everything-else",
    description: "Pet food and supplies.",
  },
  {
    slug: "clothing",
    label: "Clothing",
    group: "everything-else",
    description: "Clothing, shoes, and accessories.",
  },
  {
    slug: "electronics",
    label: "Electronics",
    group: "everything-else",
    description: "Electronics and accessories.",
  },
  {
    slug: "home-improvement",
    label: "Home improvement",
    group: "everything-else",
    description: "Hardware, tools, and home-improvement supplies.",
  },
  {
    slug: "office-school",
    label: "Office & school",
    group: "everything-else",
    description: "Office and school supplies.",
  },
  {
    slug: "entertainment",
    label: "Entertainment",
    group: "everything-else",
    description: "Books, media, games, and entertainment.",
  },
  {
    slug: "transportation",
    label: "Transportation",
    group: "everything-else",
    description: "Fuel, transit fare, and vehicle supplies.",
  },
  {
    slug: "fees-adjustments",
    label: "Fees & adjustments",
    group: "everything-else",
    description:
      "Non-product lines: CRV/deposit, bag fees, tips, delivery fees, and standalone coupons/discounts. Without this category every real receipt fails checksum.",
  },
  {
    slug: "other",
    label: "Other",
    group: "everything-else",
    description:
      "Instrumentation only: a line that genuinely fits nothing above. A rising usage rate signals a taxonomy gap — never widen another category to avoid using this one.",
  },
] as const;

const TAXONOMY_SLUGS = new Set<string>(TAXONOMY.map((c) => c.slug));

export function isCategorySlug(value: unknown): value is string {
  return typeof value === "string" && TAXONOMY_SLUGS.has(value);
}

export function subcategoriesOf(categorySlug: string): readonly TaxonomySubcategory[] {
  return TAXONOMY.find((c) => c.slug === categorySlug)?.subcategories ?? [];
}

export function isSubcategorySlug(categorySlug: string, value: unknown): value is string {
  if (typeof value !== "string") return false;
  return subcategoriesOf(categorySlug).some((s) => s.slug === value);
}

/**
 * The digits-1-through-9 seed order for a user with no usage history —
 * the tracer bullet's own situation. Roughly the most universally-common
 * first-level categories for a US grocery-heavy receipt set, picked as a
 * reasonable starting order, not a settled ranking (STON-16: picker arity
 * is open, not settled).
 */
const SEED_ORDER: readonly string[] = [
  "produce",
  "pantry",
  "dairy-eggs",
  "meat-seafood",
  "household",
  "beverages",
  "prepared-deli",
  "health-wellness",
  "bakery",
];

/**
 * The category slugs a review card's keyboard/tap picker offers directly,
 * ordered by usage — interim rule (STON-16): keys 1–8 bind to the eight
 * most-frequently-used first-level categories for that user, with a `more`
 * key opening the full list. Digits run out at nine: only the first
 * `min(slugs.length, 9)` entries can ever carry a digit key (1-9); a caller
 * binding keys must never reach for `0` or a modifier to extend this.
 *
 * `usageCounts` is keyed by category slug; a user with no history at all
 * (this ticket's own situation) falls back to `SEED_ORDER`. This function
 * does not decide arity — it returns every slug it has an opinion on,
 * ordered; the caller decides how many of them get a digit key and where
 * `more` lives. Deliberately isolated in this one function so a later
 * redesign of picker arity (STON-8) touches one place.
 */
export function pickerCategorySlugs(usageCounts: Readonly<Record<string, number>>): string[] {
  const counted = Object.entries(usageCounts).filter(([slug]) => isCategorySlug(slug));
  if (counted.length === 0) {
    return [...SEED_ORDER];
  }
  const ranked = counted
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([slug]) => slug);
  const remaining = TAXONOMY.map((c) => c.slug).filter((slug) => !ranked.includes(slug));
  return [...ranked, ...remaining];
}
