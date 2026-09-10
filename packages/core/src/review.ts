/**
 * Routing — tracer-bullet subset (AGENTS.md, Pipeline rules: routing
 * levers are env vars, manually tuned; no auto feedback loop). This
 * ticket implements only the reason precedence; STON-7 owns the full
 * lever composition (queue budget + refill, DAILY_REVIEW_CAP, sampleRoll,
 * the backlog anti-join, the novelty hook) and **deletes this file** —
 * do not rename it, so that deletion is a clean one-file diff.
 *
 * v1 refill/sampling is out of scope here: every line item is routed
 * (SAMPLING_RATE stays 1.0 in this ticket's own writes), no cap, no
 * refill, no daily cap. `review.ts` decides only *why* a line item is
 * surfaced, by precedence:
 *
 *   checksum_fail > low_confidence > bootstrap
 *
 * A checksum failure routes the *whole* receipt (every line item on it
 * gets a `checksum_fail` review row, regardless of that item's own
 * confidence) — STON-7's plan depends on this staying exactly as written.
 * `low_confidence` fires below the confidence floor, and when confidence
 * is NULL (a model that declined to guess is not "confident").
 */

export type RoutingReason = "checksum_fail" | "low_confidence" | "bootstrap";

export interface RoutingLineItemInput {
  confidence: number | null;
}

export interface RoutingDecisionInput {
  /** Whether the receipt as a whole failed the arithmetic checksum —
   * `evaluateChecksum(...).result === "fail"`. When true every line item
   * on the receipt routes for this reason, regardless of its own
   * confidence. */
  receiptChecksumFailed: boolean;
  confidenceFloor: number;
}

/**
 * The reason a single line item is routed to review, by precedence.
 * `bootstrap` is the tracer's own fallback reason for a line item that is
 * neither a checksum failure nor low-confidence — v1 routes every item
 * (SAMPLING_RATE 1.0), so something must name "surfaced with no other
 * reason" until STON-7's sampling/novelty levers exist.
 */
export function routingReason(
  lineItem: RoutingLineItemInput,
  decision: RoutingDecisionInput,
): RoutingReason {
  if (decision.receiptChecksumFailed) return "checksum_fail";
  if (lineItem.confidence === null || lineItem.confidence < decision.confidenceFloor) {
    return "low_confidence";
  }
  return "bootstrap";
}
