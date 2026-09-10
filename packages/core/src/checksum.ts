/**
 * Arithmetic checksum (AGENTS.md, Data conventions #4; Review invariant
 * 17): a receipt passes when
 *
 *   |Σ line_items + tax − stated_total| <= max(2 cents, 0.5% of stated_total)
 *
 * calling the existing `checksumToleranceCents()` from config.ts rather
 * than restating `max(2, 0.5%)` inline. Σ is over `extended_price_cents`
 * only — fees (CRV, bag fees, tips, delivery) are already line items
 * carrying `fees-adjustments`, so they are already inside Σ line_items;
 * this module never adds a separate fees term. `discount_cents` is
 * informational and is not summed either.
 */

import { checksumToleranceCents } from "./config.js";

export type ChecksumResult = "pass" | "fail" | "not_run";

export interface ChecksumInput {
  /** `extended_price_cents` for every line item — the only sum this
   * checksum takes. Fees are already line items in this list. */
  lineItemCents: readonly number[];
  taxCents: number | null;
  statedTotalCents: number | null;
}

export interface ChecksumOutput {
  result: ChecksumResult;
  deltaCents: number | null;
  toleranceCents: number | null;
}

export function evaluateChecksum(input: ChecksumInput): ChecksumOutput {
  if (input.statedTotalCents === null) {
    return { result: "not_run", deltaCents: null, toleranceCents: null };
  }

  const lineItemSum = input.lineItemCents.reduce((sum, cents) => sum + cents, 0);
  const taxCents = input.taxCents ?? 0;
  const computedTotal = lineItemSum + taxCents;
  const deltaCents = computedTotal - input.statedTotalCents;
  const toleranceCents = checksumToleranceCents(input.statedTotalCents);

  return {
    result: Math.abs(deltaCents) <= toleranceCents ? "pass" : "fail",
    deltaCents,
    toleranceCents,
  };
}
