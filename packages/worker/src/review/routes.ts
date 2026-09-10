/**
 * `GET /api/review/next` and `POST /api/review/:queueId/verdict` — the
 * review card's data path (STON-2 tracer bullet; STON-8 widens: `?limit=`,
 * `surfaced_at`, a wider response shape).
 */

import { Hono } from "hono";
import { getSessionUser } from "../auth/session.js";
import { writeVerdict } from "./verdict.js";

export const reviewRoutes = new Hono<{ Bindings: Env }>();

const DEFAULT_PAGE_SIZE = 20;

interface NextReviewRow {
  queue_id: string;
  reason: string;
  raw_text: string;
  category: string;
  subcategory: string | null;
  confidence: number | null;
  extended_price_cents: number | null;
  merchant_raw: string | null;
  merchant_normalized: string | null;
  purchased_at: string | null;
}

/**
 * Ordered on the raw `purchased_at` column, most recent first (the
 * settled v1 refill ordering — AGENTS.md, Pipeline rules). Never
 * `substr()`/`strftime()` in the ORDER BY (discards
 * `idx_receipts_purchased_at`) and never parsed with `new Date(...)`
 * anywhere in this request path.
 *
 * `getSessionUser` is called here so a real caller exists at this call
 * site, but — like `GET /api/receipts/:id` (`receipts/upload.ts`) — the
 * query below has nothing to filter on: `receipts` has no `user_id`
 * column, so this returns every unresolved review item for every user.
 * STON-4 owns adding the real ownership check once users are real; this
 * comment is the seam that should fail loudly when that lands, rather
 * than silently continuing to return everyone's rows.
 */
reviewRoutes.get("/next", async (c) => {
  getSessionUser(c);
  const limitParam = Number(c.req.query("limit"));
  const limit =
    Number.isInteger(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : DEFAULT_PAGE_SIZE;

  const { results } = await c.env.DB.prepare(
    `SELECT rq.id AS queue_id, rq.reason,
            li.raw_text, li.category, li.subcategory, li.confidence, li.extended_price_cents,
            r.merchant_raw, r.merchant_normalized, r.purchased_at
       FROM review_queue rq
       JOIN line_items li ON li.id = rq.line_item_id
       JOIN receipts r ON r.id = li.receipt_id
      WHERE rq.resolved_at IS NULL
      ORDER BY r.purchased_at DESC
      LIMIT ?`,
  )
    .bind(limit)
    .all<NextReviewRow>();

  return c.json({
    items: results.map((row) => ({
      queueId: row.queue_id,
      reason: row.reason,
      rawText: row.raw_text,
      category: row.category,
      subcategory: row.subcategory,
      confidence: row.confidence,
      extendedPriceCents: row.extended_price_cents,
      merchantRaw: row.merchant_raw,
      merchantNormalized: row.merchant_normalized,
      purchasedAt: row.purchased_at,
    })),
  });
});

interface VerdictBody {
  verdict?: unknown;
  correctedCategory?: unknown;
  correctedSubcategory?: unknown;
}

reviewRoutes.post("/:queueId/verdict", async (c) => {
  const user = getSessionUser(c);
  const queueId = c.req.param("queueId");

  let body: VerdictBody;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "expected a JSON body" }, 400);
  }

  if (body.verdict !== "confirmed" && body.verdict !== "corrected" && body.verdict !== "skipped") {
    return c.json({ error: 'verdict must be "confirmed", "corrected", or "skipped"' }, 400);
  }

  const outcome = await writeVerdict(c.env.DB, {
    queueId,
    verdict: body.verdict,
    correctedCategory: typeof body.correctedCategory === "string" ? body.correctedCategory : null,
    correctedSubcategory:
      typeof body.correctedSubcategory === "string" ? body.correctedSubcategory : null,
    labeler: user.labeler,
  });

  if (!outcome.ok) {
    if (outcome.error === "not-found") {
      return c.json({ error: "no such review queue item" }, 404);
    }
    if (outcome.error === "already-resolved") {
      return c.json({ error: "review queue item is already resolved" }, 409);
    }
    if (outcome.error === "invalid-corrected-subcategory") {
      return c.json(
        {
          error: "correctedSubcategory is not a known taxonomy subcategory slug for that category",
        },
        400,
      );
    }
    return c.json({ error: "correctedCategory is not a known taxonomy category slug" }, 400);
  }

  return c.json({
    ok: true,
    queueId,
    verdict: body.verdict,
    goldenSetWritten: outcome.goldenSetWritten,
  });
});
