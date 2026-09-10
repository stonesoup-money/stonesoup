import { describe, expect, it } from "vitest";
import {
  DEDUPE_DATE_WINDOW_DAYS,
  type DedupeCandidate,
  type IncomingReceipt,
  matchDecision,
  merchantMatchToken,
  nextDay,
  purchaseDay,
  resolveDedupe,
  selectSurvivor,
  shiftDay,
} from "./index.js";

/**
 * STON-11's test table — the deliverable as much as the rule is. Synthetic
 * fixtures only; no real receipt text, ever (AGENTS.md, "No real receipts
 * in the repo, ever").
 */

function candidate(overrides: Partial<DedupeCandidate> = {}): DedupeCandidate {
  return {
    id: "candidate-1",
    createdAt: "2026-03-05T08:00:00.000Z",
    merchantNormalized: "Trader Joe's",
    purchasedAt: "2026-03-05",
    totalCents: 4_312,
    paymentLast4: null,
    sourceTypes: ["gmail"],
    ...overrides,
  };
}

function incoming(overrides: Partial<IncomingReceipt> = {}): IncomingReceipt {
  return {
    id: "incoming-1",
    createdAt: "2026-03-05T09:00:00.000Z",
    merchantNormalized: "TRADER JOE'S #123",
    purchasedAt: "2026-03-05T18:14:00.000Z",
    totalCents: 4_312,
    paymentLast4: null,
    sourceType: "photo",
    ...overrides,
  };
}

describe("merchantMatchToken", () => {
  it("case-folds, strips punctuation, and collapses whitespace", () => {
    expect(merchantMatchToken("Trader Joe's")).toBe("trader joes");
  });

  it("strips a trailing printed store number", () => {
    expect(merchantMatchToken("TRADER JOE'S #123")).toBe("trader joes");
  });

  it("agrees on the two shapes that prove raw-text matching would fail", () => {
    expect(merchantMatchToken("TRADER JOE'S #123")).toBe(merchantMatchToken("Trader Joe's"));
  });

  it("returns null for a NULL merchant_normalized", () => {
    expect(merchantMatchToken(null)).toBeNull();
  });

  it("returns null for an all-punctuation/whitespace value", () => {
    expect(merchantMatchToken("  #123  ")).toBeNull();
  });
});

describe("purchaseDay / nextDay / shiftDay", () => {
  it("purchaseDay reads the printed date out of either accepted shape", () => {
    expect(purchaseDay("2026-03-05")).toBe("2026-03-05");
    expect(purchaseDay("2026-03-05T18:14:00.000Z")).toBe("2026-03-05");
  });

  it("nextDay advances one calendar day, including across a month boundary", () => {
    expect(nextDay("2026-03-05")).toBe("2026-03-06");
    expect(nextDay("2026-02-28")).toBe("2026-03-01");
  });

  it("shiftDay moves backward and forward by an arbitrary count", () => {
    expect(shiftDay("2026-03-05", -1)).toBe("2026-03-04");
    expect(shiftDay("2026-03-05", 2)).toBe("2026-03-07");
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("matchDecision — the case table", () => {
  it("1: photo date-only + email timestamp, same printed day, same merchant token, same total -> merge", () => {
    const c = candidate({ purchasedAt: "2026-03-05" });
    const i = incoming({ purchasedAt: "2026-03-05T02:14:00.000Z" });
    expect(matchDecision(c, i)).toBe("merge");
  });

  it("2: asymmetric date — photo 2026-03-05, email 2026-03-06T02:14:00Z (same local purchase) -> merge via ±1 day window", () => {
    const c = candidate({ purchasedAt: "2026-03-05" });
    const i = incoming({ purchasedAt: "2026-03-06T02:14:00.000Z" });
    expect(matchDecision(c, i)).toBe("merge");
  });

  it("3: both date-only, adjacent days -> no merge (same shape, exact day)", () => {
    const c = candidate({ purchasedAt: "2026-03-05" });
    const i = incoming({ purchasedAt: "2026-03-06" });
    expect(matchDecision(c, i)).toBe("date-mismatch");
  });

  it("4: both full timestamps, same day, different times -> merge", () => {
    const c = candidate({ purchasedAt: "2026-03-05T08:00:00.000Z" });
    const i = incoming({ purchasedAt: "2026-03-05T23:59:00.000Z" });
    expect(matchDecision(c, i)).toBe("merge");
  });

  it("5: both full timestamps, adjacent days -> no merge", () => {
    const c = candidate({ purchasedAt: "2026-03-05T23:59:00.000Z" });
    const i = incoming({ purchasedAt: "2026-03-06T00:01:00.000Z" });
    expect(matchDecision(c, i)).toBe("date-mismatch");
  });

  it("6: totals differ by 1 cent -> no merge (exact, explicitly not the checksum tolerance)", () => {
    const c = candidate({ totalCents: 4_312 });
    const i = incoming({ totalCents: 4_313 });
    expect(matchDecision(c, i)).toBe("total-mismatch");
  });

  it("7: split payment — two receipts, same merchant/day, neither total equal -> no merge", () => {
    const c = candidate({ totalCents: 2_000 });
    const i = incoming({ totalCents: 2_312 });
    expect(matchDecision(c, i)).toBe("total-mismatch");
  });

  it("8: different merchant token -> no merge", () => {
    const c = candidate({ merchantNormalized: "Trader Joe's" });
    const i = incoming({ merchantNormalized: "Whole Foods" });
    expect(matchDecision(c, i)).toBe("merchant-mismatch");
  });

  it("9: merchant_raw differs, token equal -> merge (the case that proves raw-text matching would break the feature)", () => {
    // merchant_raw itself is never part of the comparison — only
    // merchant_normalized, via the folding token. This fixture uses the
    // exact pair from the ticket: a photo's printed store-numbered form
    // and an email's clean form, both landing in merchant_normalized as
    // whatever each source's extraction produced.
    const c = candidate({ merchantNormalized: "Trader Joe's" });
    const i = incoming({ merchantNormalized: "TRADER JOE'S #123" });
    expect(matchDecision(c, i)).toBe("merge");
  });

  it("10a: merchant_normalized NULL on the candidate -> no merge", () => {
    const c = candidate({ merchantNormalized: null });
    const i = incoming();
    expect(matchDecision(c, i)).toBe("merchant-null");
  });

  it("10b: merchant_normalized NULL on the incoming side -> no merge", () => {
    const c = candidate();
    const i = incoming({ merchantNormalized: null });
    expect(matchDecision(c, i)).toBe("merchant-null");
  });

  it("11a: total_cents NULL on the candidate -> no merge", () => {
    const c = candidate({ totalCents: null });
    const i = incoming();
    expect(matchDecision(c, i)).toBe("total-null");
  });

  it("11b: total_cents NULL on the incoming side -> no merge", () => {
    const c = candidate();
    const i = incoming({ totalCents: null });
    expect(matchDecision(c, i)).toBe("total-null");
  });

  it("12a: purchased_at NULL on the candidate -> no merge", () => {
    const c = candidate({ purchasedAt: null });
    const i = incoming();
    expect(matchDecision(c, i)).toBe("date-null");
  });

  it("12b: purchased_at NULL on the incoming side -> no merge", () => {
    const c = candidate();
    const i = incoming({ purchasedAt: null });
    expect(matchDecision(c, i)).toBe("date-null");
  });

  it("13: both payment_last4 present and different -> no merge (veto)", () => {
    const c = candidate({ paymentLast4: "1234" });
    const i = incoming({ paymentLast4: "5678" });
    expect(matchDecision(c, i)).toBe("payment-last4-mismatch");
  });

  it("14: one payment_last4 NULL -> veto does not fire -> merge", () => {
    const c = candidate({ paymentLast4: "1234" });
    const i = incoming({ paymentLast4: null });
    expect(matchDecision(c, i)).toBe("merge");
  });

  it("15: same source type on both sides (two photos) -> no merge", () => {
    const c = candidate({ sourceTypes: ["photo"] });
    const i = incoming({ sourceType: "photo" });
    expect(matchDecision(c, i)).toBe("same-source-type");
  });

  it("respects a custom windowDays override", () => {
    const c = candidate({ purchasedAt: "2026-03-05" });
    const i = incoming({ purchasedAt: "2026-03-08T02:14:00.000Z" });
    // Default window (1 day) rejects a 3-day gap even across a shape
    // mismatch; a wider override accepts it. Proves the parameter is wired
    // through, not just DEDUPE_DATE_WINDOW_DAYS baked in.
    expect(matchDecision(c, i)).toBe("date-mismatch");
    expect(matchDecision(c, i, 3)).toBe("merge");
  });
});

describe("selectSurvivor — case 17: deterministic (older created_at wins; tie -> lower id)", () => {
  it("older created_at wins regardless of argument order", () => {
    const older = { id: "b", createdAt: "2026-03-05T08:00:00.000Z" };
    const newer = { id: "a", createdAt: "2026-03-05T09:00:00.000Z" };
    expect(selectSurvivor(older, newer)).toBe(older);
    expect(selectSurvivor(newer, older)).toBe(older);
  });

  it("ties on created_at break toward the lexicographically lower id", () => {
    const same = "2026-03-05T08:00:00.000Z";
    const lower = { id: "aaa", createdAt: same };
    const higher = { id: "zzz", createdAt: same };
    expect(selectSurvivor(lower, higher)).toBe(lower);
    expect(selectSurvivor(higher, lower)).toBe(lower);
  });

  it("an exact self-tie (same id and created_at) returns a stable choice", () => {
    const a = { id: "same-id", createdAt: "2026-03-05T08:00:00.000Z" };
    const b = { id: "same-id", createdAt: "2026-03-05T08:00:00.000Z" };
    expect(selectSurvivor(a, b)).toBe(a);
  });
});

describe("resolveDedupe — case 16: collision (two candidates match one incoming) -> ambiguous, no merge, both survive", () => {
  it("reports ambiguous with the match count, picking neither candidate", () => {
    const i = incoming();
    const first = candidate({ id: "first", sourceTypes: ["gmail"] });
    const second = candidate({ id: "second", sourceTypes: ["gmail"] });
    const resolution = resolveDedupe(i, [first, second]);
    expect(resolution).toEqual({ outcome: "ambiguous", matchCount: 2 });
  });
});

describe("resolveDedupe — no candidates match", () => {
  it("reports no-match when nothing in the candidate set matches", () => {
    const i = incoming();
    const nonMatch = candidate({ merchantNormalized: "Whole Foods" });
    expect(resolveDedupe(i, [nonMatch])).toEqual({ outcome: "no-match" });
  });

  it("reports no-match against an empty candidate set", () => {
    expect(resolveDedupe(incoming(), [])).toEqual({ outcome: "no-match" });
  });
});

describe("resolveDedupe — case 17: a single match resolves survivor/duplicate deterministically", () => {
  it("picks the older side as survivor when the candidate is older", () => {
    const i = incoming({ id: "incoming-1", createdAt: "2026-03-05T09:00:00.000Z" });
    const c = candidate({ id: "candidate-1", createdAt: "2026-03-05T08:00:00.000Z" });
    const resolution = resolveDedupe(i, [c]);
    // toMatchObject, not toEqual: resolveDedupe returns the full
    // candidate/incoming record on survivor/duplicate (useful to callers),
    // not a value stripped down to {id, createdAt} — only those two fields
    // are the contract this test cares about.
    expect(resolution).toMatchObject({
      outcome: "merge",
      survivor: { id: "candidate-1", createdAt: "2026-03-05T08:00:00.000Z" },
      duplicate: { id: "incoming-1", createdAt: "2026-03-05T09:00:00.000Z" },
    });
  });

  it("picks the incoming side as survivor when it is older than the candidate", () => {
    const i = incoming({ id: "incoming-1", createdAt: "2026-03-05T07:00:00.000Z" });
    const c = candidate({ id: "candidate-1", createdAt: "2026-03-05T08:00:00.000Z" });
    const resolution = resolveDedupe(i, [c]);
    expect(resolution).toMatchObject({
      outcome: "merge",
      survivor: { id: "incoming-1", createdAt: "2026-03-05T07:00:00.000Z" },
      duplicate: { id: "candidate-1", createdAt: "2026-03-05T08:00:00.000Z" },
    });
  });
});

describe("resolveDedupe — case 18: incoming already linked to the survivor (re-run) -> no-op, idempotent", () => {
  it("a source that already merged in once is vetoed on a second run, not re-merged", () => {
    // Simulates re-processing the same source after a merge already
    // happened: the survivor already carries a receipt_sources row of the
    // incoming source's type, so the same-source-type veto fires and the
    // rule reports no-match rather than attempting a second merge. The
    // caller (packages/worker/src/dedupe/merge.ts) re-points the source
    // link idempotently via ON CONFLICT DO UPDATE without ever asking this
    // pure rule to merge twice.
    const survivorAlreadyLinked = candidate({ id: "survivor", sourceTypes: ["gmail", "photo"] });
    const i = incoming({ sourceType: "photo" });
    expect(resolveDedupe(i, [survivorAlreadyLinked])).toEqual({ outcome: "no-match" });
  });

  it("resolveDedupe is a pure function: calling it twice with identical inputs is idempotent", () => {
    const i = incoming();
    const c = candidate();
    expect(resolveDedupe(i, [c])).toEqual(resolveDedupe(i, [c]));
  });
});

describe("DEDUPE_DATE_WINDOW_DAYS", () => {
  it("is the documented default of 1 day", () => {
    expect(DEDUPE_DATE_WINDOW_DAYS).toBe(1);
  });
});
