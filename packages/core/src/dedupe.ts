/**
 * Dedupe — photo/email merge (STON-11).
 *
 * Same purchase arriving via photo + email must merge into one `receipts`
 * row with multiple `receipt_sources` references, not land as two receipts
 * (AGENTS.md, Pipeline rules; Review invariant 20).
 *
 * This module is the **pure rule only** — no D1, no workers types, so the
 * case table below can be a real unit test with zero setup. The D1-backed
 * primitives that use this rule (`findMergeCandidates`, `linkOrMerge`) live
 * in `packages/worker/src/dedupe/merge.ts`, because the rule needs to run
 * against real rows and issue an ordered `db.batch()` — this file cannot
 * see a database at all.
 *
 * The matching rule (all three must hold, each NULL-on-either-side is a
 * no-match, not a wildcard):
 *
 *   merchant — `merchantMatchToken(merchant_normalized)` equal. Never
 *     compares `merchant_raw`: a photo prints "TRADER JOE'S #123" where the
 *     email says "Trader Joe's" — matching raw text would mean the feature
 *     never fires.
 *   date — the printed calendar day of `purchased_at` equal. If exactly one
 *     side is date-only and the other a full timestamp, a
 *     `±DEDUPE_DATE_WINDOW_DAYS` window applies instead of exact-day — a
 *     `...Z` instant's true local day is unknown within a day. Same-shape
 *     pairs never widen.
 *   total — `total_cents` exactly equal. Not the checksum tolerance — that
 *     constant bounds one receipt's own extraction arithmetic error; two
 *     sources describing one purchase both print the same stated total, so
 *     there is no arithmetic between them to be off by (Review invariant 17).
 *
 * Plus two vetoes, which can only *prevent* a merge, never cause one (the
 * key stays merchant + date + total):
 *
 *   - different source types only: a candidate that already carries a
 *     `receipt_sources` row of the incoming source's type never merges.
 *     Two photos of "the same" purchase are far more likely two real
 *     purchases; two emails are already handled by the `external_id`
 *     unique index (email idempotency, a different mechanism — Epic 4).
 *   - payment_last4 disagreement: both sides non-NULL and different vetoes
 *     the merge.
 *
 * Collision handling is the point of this ticket: two candidates matching
 * one incoming receipt is ambiguous, so `resolveDedupe` reports it as such
 * rather than picking one — the caller must leave every receipt standing.
 * The rule fails toward a visible duplicate, never toward destroying a real
 * receipt.
 */

import { DEDUPE_DATE_WINDOW_DAYS } from "./config.js";
import { isIsoDate } from "./dates.js";

export type SourceType = "gmail" | "photo";

/** The three key fields the merge rule compares, plus the one veto field
 * that isn't part of the key. Shared shape for both an already-persisted
 * candidate row and the incoming extraction result. */
export interface DedupeReceiptLike {
  merchantNormalized: string | null;
  purchasedAt: string | null;
  totalCents: number | null;
  paymentLast4: string | null;
}

/** A receipt already in the database that might match the incoming one. */
export interface DedupeCandidate extends DedupeReceiptLike {
  id: string;
  createdAt: string;
  /** Every `sources.type` already linked to this receipt via
   * `receipt_sources` — the same-source-type veto reads this list. */
  sourceTypes: readonly SourceType[];
}

/** The receipt whose extraction just completed and is being persisted. */
export interface IncomingReceipt extends DedupeReceiptLike {
  id: string;
  createdAt: string;
  sourceType: SourceType;
}

/** A minimal shape for deterministic survivor selection — both
 * `DedupeCandidate` and `IncomingReceipt` satisfy this structurally. */
export interface SurvivorCandidate {
  id: string;
  createdAt: string;
}

/**
 * `"merge"`, or a specific reason a merge did *not* happen — the reason is
 * part of the return value (not folded into a generic `"no-match"`) so a
 * caller can log or test exactly which check stopped the merge, and so the
 * test table below reads as a direct transcription of the rule.
 */
export type MatchDecision =
  | "merge"
  | "merchant-null"
  | "merchant-mismatch"
  | "date-null"
  | "date-mismatch"
  | "total-null"
  | "total-mismatch"
  | "same-source-type"
  | "payment-last4-mismatch";

/**
 * Case-folds a `merchant_normalized` value into a token two sources can
 * agree on: lowercased, punctuation stripped, a trailing printed store
 * number (`#123`) stripped, whitespace collapsed. Returns `null` for a NULL
 * or all-punctuation/whitespace input — the caller treats a `null` token as
 * "no match" the same way a NULL key field is, never as a wildcard.
 *
 * Deliberately never looks at `merchant_raw` — see the module comment.
 */
export function merchantMatchToken(merchantNormalized: string | null): string | null {
  if (merchantNormalized === null) return null;
  const withoutStoreNumber = merchantNormalized.replace(/#\s*\d+\s*$/, "");
  const folded = withoutStoreNumber
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return folded.length > 0 ? folded : null;
}

/**
 * The printed calendar day of a `purchased_at` value, shape-agnostic: both
 * accepted shapes (`YYYY-MM-DD` and `YYYY-MM-DDTHH:MM:SS(.sss)?Z`) start
 * with the same 10-character date, so slicing it is correct for either one.
 */
export function purchaseDay(purchasedAt: string): string {
  return purchasedAt.slice(0, 10);
}

/** Shifts a `YYYY-MM-DD` day string by `deltaDays` (positive or negative),
 * returning another `YYYY-MM-DD` string. Used to build both `nextDay` and
 * the half-open query range in the worker layer. */
export function shiftDay(day: string, deltaDays: number): string {
  const base = Date.parse(`${day}T00:00:00.000Z`);
  const shifted = new Date(base + deltaDays * 86_400_000);
  const iso = shifted.toISOString();
  return iso.slice(0, 10);
}

/** The day after `day`, as `YYYY-MM-DD`. The half-open range
 * `[day, nextDay(day))` covers every `purchased_at` value printed on that
 * calendar day regardless of shape — `'T'` sorts above every digit, so a
 * date-only value and a full timestamp on the same day both fall inside it
 * lexicographically (verified; see `migrations/0001_initial_schema.sql`). */
export function nextDay(day: string): string {
  return shiftDay(day, 1);
}

function dateMatches(a: string, b: string, windowDays: number): boolean {
  const dayA = purchaseDay(a);
  const dayB = purchaseDay(b);
  const sameShape = isIsoDate(a) === isIsoDate(b);
  if (sameShape) {
    return dayA === dayB;
  }
  const diffDays = Math.round(
    (Date.parse(`${dayB}T00:00:00.000Z`) - Date.parse(`${dayA}T00:00:00.000Z`)) / 86_400_000,
  );
  return Math.abs(diffDays) <= windowDays;
}

/**
 * Decides whether one already-persisted `candidate` and the `incoming`
 * receipt describe the same purchase. Order of checks mirrors the rule:
 * the merchant/date/total key first (any NULL or mismatch short-circuits
 * with the specific reason), then the two vetoes, which only run once the
 * key already matched — they can subtract a merge, never add one.
 */
export function matchDecision(
  candidate: DedupeCandidate,
  incoming: IncomingReceipt,
  windowDays: number = DEDUPE_DATE_WINDOW_DAYS,
): MatchDecision {
  const candidateToken = merchantMatchToken(candidate.merchantNormalized);
  const incomingToken = merchantMatchToken(incoming.merchantNormalized);
  if (candidateToken === null || incomingToken === null) return "merchant-null";
  if (candidateToken !== incomingToken) return "merchant-mismatch";

  if (candidate.purchasedAt === null || incoming.purchasedAt === null) return "date-null";
  if (!dateMatches(candidate.purchasedAt, incoming.purchasedAt, windowDays)) return "date-mismatch";

  if (candidate.totalCents === null || incoming.totalCents === null) return "total-null";
  if (candidate.totalCents !== incoming.totalCents) return "total-mismatch";

  if (candidate.sourceTypes.includes(incoming.sourceType)) return "same-source-type";

  if (
    candidate.paymentLast4 !== null &&
    incoming.paymentLast4 !== null &&
    candidate.paymentLast4 !== incoming.paymentLast4
  ) {
    return "payment-last4-mismatch";
  }

  return "merge";
}

/** Deterministic, testable survivor selection: older `created_at` wins; on
 * a tie, the lexicographically lower `id`. ISO 8601 timestamps sort
 * chronologically as plain strings, so string comparison is exact. */
export function selectSurvivor(a: SurvivorCandidate, b: SurvivorCandidate): SurvivorCandidate {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? a : b;
  }
  return a.id <= b.id ? a : b;
}

export type DedupeResolution =
  | { outcome: "no-match" }
  | { outcome: "ambiguous"; matchCount: number }
  | { outcome: "merge"; survivor: SurvivorCandidate; duplicate: SurvivorCandidate };

/**
 * The full orchestration of the rule against a candidate set: filters
 * `candidates` down to the ones `matchDecision` calls a merge, then applies
 * the collision rule — zero matches is `"no-match"`, exactly one is
 * `"merge"` (with survivor/duplicate already resolved), two or more is
 * `"ambiguous"` and must never merge (two real distinct purchases at the
 * same merchant, same day, same total must not be silently combined).
 *
 * Pure — the D1 candidate query that produces `candidates` lives in
 * `packages/worker/src/dedupe/merge.ts`.
 */
export function resolveDedupe(
  incoming: IncomingReceipt,
  candidates: readonly DedupeCandidate[],
  windowDays: number = DEDUPE_DATE_WINDOW_DAYS,
): DedupeResolution {
  const matches = candidates.filter(
    (candidate) => matchDecision(candidate, incoming, windowDays) === "merge",
  );

  if (matches.length === 0) return { outcome: "no-match" };
  if (matches.length > 1) return { outcome: "ambiguous", matchCount: matches.length };

  const [match] = matches;
  if (!match) throw new Error("resolveDedupe: unreachable — matches.length === 1 but no element");

  const survivor = selectSurvivor(incoming, match);
  const duplicate = survivor.id === incoming.id ? match : incoming;
  return { outcome: "merge", survivor, duplicate };
}
