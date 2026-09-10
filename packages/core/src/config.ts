/**
 * Config values, not hardcodes (AGENTS.md, House rules). Each tunable is a
 * single named export here so a human can retune it in one place; nothing
 * in this repo should inline a literal for one of these.
 *
 * Defaults mirror `wrangler.jsonc`'s `vars` block — that file is what a
 * deployment actually runs with, this module is what code imports when it
 * needs the same value at build/test time or as a fallback.
 */

/** Taxonomy enumeration version. Provisional — see AGENTS.md, Taxonomy. */
export const TAXONOMY_VERSION = "0.1.0";

/** Default Anthropic model for receipt extraction. A default, not a pin —
 * changing it goes through the certification suite (STON-12). */
export const DEFAULT_EXTRACTION_MODEL = "claude-opus-5";

/** Gmail incremental sync: initial backfill window, in days. */
export const BACKFILL_WINDOW_DAYS = 90;

/**
 * Checksum tolerance (AGENTS.md, Data conventions #4):
 * a receipt passes when
 *   |Σ line_items + tax − stated_total| <= max(CHECKSUM_TOLERANCE_MIN_CENTS, CHECKSUM_TOLERANCE_PERCENT * stated_total)
 * Fees (CRV, bag fees, tips, delivery) are line items carrying
 * `fees-adjustments` — they are already inside Σ line_items; never add them
 * again.
 */
export const CHECKSUM_TOLERANCE_MIN_CENTS = 2;
export const CHECKSUM_TOLERANCE_PERCENT = 0.005;

export function checksumToleranceCents(statedTotalCents: number): number {
  return Math.max(
    CHECKSUM_TOLERANCE_MIN_CENTS,
    Math.round(CHECKSUM_TOLERANCE_PERCENT * statedTotalCents),
  );
}

/** Routing levers (env vars, manually tuned — no auto feedback loop). */
export const SAMPLING_RATE_DEFAULT = 1.0;
export const CONFIDENCE_FLOOR_DEFAULT = 0.85;
export const DAILY_REVIEW_CAP_DEFAULT = 200;

/** Review queue budget: hard cap, and the level a refill kicks in at.
 * Both numbers matter together — quoting only the cap invites refilling to
 * the cap on every dequeue, a different UX and a different D1 write pattern. */
export const REVIEW_QUEUE_CAP = 100;
export const REVIEW_QUEUE_REFILL_AT = 20;

/** Golden-set contribution default (brief, "Golden-set contribution
 * defaults"): hosted free tier ships this "on" and required by ToS;
 * self-host ships "on" too, clearly disclosed, opt-out honest. "on" | "off". */
export const GOLDEN_SET_CONTRIBUTION_DEFAULT = "on";

/**
 * Dedupe (STON-11): when comparing two receipts' printed purchase day and
 * the two sides use different `purchased_at` shapes (one date-only, one
 * full timestamp), the exact-day comparison widens by this many days on
 * each side instead — a `...Z` instant's true local calendar day is
 * unknown within a day, so exact-day comparison alone would silently miss
 * a same-purchase pair straddling a UTC midnight. Same-shape comparisons
 * never widen. Not a wrangler.jsonc var (not an env-tunable lever) — see
 * CORE_ONLY_EXPORTS in scripts/verify-config-single-source.mjs. See
 * packages/core/src/dedupe.ts.
 */
export const DEDUPE_DATE_WINDOW_DAYS = 1;

/**
 * Deployment mode and operator identity for the public legal pages
 * (STON-13). `DEPLOYMENT_MODE_DEFAULT` is what an open-artifact checkout
 * ships with — a self-hosted instance needs no operator identity at all,
 * so its rendered privacy policy and ToS say exactly that and never read
 * `OPERATOR_NAME_DEFAULT` / `OPERATOR_CONTACT_DEFAULT`. Those two exist
 * for `DEPLOYMENT_MODE = "hosted"` only, and their default value is a
 * deliberately unmissable placeholder, not a guess: the legal entity
 * name and contact address for a hosted fleet are facts only a human
 * has, and inventing them would be fabricating a legal document. See
 * packages/core/src/legal/context.ts, which re-exports these under the
 * names the document templates import, and docs/privacy-claims.md.
 */
export const DEPLOYMENT_MODE_DEFAULT = "self-hosted";
export const OPERATOR_NAME_DEFAULT =
  "[[LEGAL_ENTITY — a human must fill this in before this instance serves a hosted user — see docs/privacy-claims.md]]";
export const OPERATOR_CONTACT_DEFAULT =
  "[[CONTACT_ADDRESS — a human must fill this in before this instance serves a hosted user — see docs/privacy-claims.md]]";
