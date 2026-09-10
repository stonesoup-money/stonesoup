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
