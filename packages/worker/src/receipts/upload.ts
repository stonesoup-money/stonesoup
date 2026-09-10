/**
 * `POST /api/receipts` — the photo path's upload node (STON-2 tracer
 * bullet; STON-5 widens: HEIC/multi-page, downscale, resumable upload).
 * JPEG/PNG only, size-capped by `RECEIPT_UPLOAD_MAX_BYTES`. Mints the
 * receipt uuid, puts the object at `receiptR2Key` (AGENTS.md, Data
 * conventions #6), then one `db.batch()`:
 *
 *   1. ensure the `photo` `sources` row at a deterministic id
 *      (`photo:${userId}`), `ON CONFLICT (id) DO NOTHING`;
 *   2. insert `receipts` with `merchant_raw` omitted (NULL — migration
 *      `0002`'s write-once-from-NULL state), `status = 'pending'`, `r2_key`;
 *   3. insert the `receipt_sources` link, via the same
 *      `INSERT ... SELECT ... WHERE NOT EXISTS` shape
 *      `packages/worker/src/dedupe/merge.ts` already uses for the photo
 *      case, so a later `linkOrMerge` call is a no-op rather than a
 *      duplicate.
 *
 * Then `EXTRACTION_QUEUE.send(job)` — extraction is never inline
 * (AGENTS.md, Pipeline rules).
 */

import {
  EXTRACTION_SCHEMA_VERSION,
  type ExtractionJob,
  RECEIPT_UPLOAD_MAX_BYTES,
  receiptR2Key,
} from "@stonesoup/core";
import { Hono } from "hono";
import { getSessionUser } from "../auth/session.js";

const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png"]);

export const receiptsRoutes = new Hono<{ Bindings: Env }>();

receiptsRoutes.post("/", async (c) => {
  const user = getSessionUser(c);

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ error: "expected multipart/form-data" }, 400);
  }

  const file = formData.get("receipt");
  if (!(file instanceof File)) {
    return c.json({ error: 'multipart field "receipt" (a JPEG or PNG file) is required' }, 400);
  }
  if (!ALLOWED_CONTENT_TYPES.has(file.type)) {
    return c.json({ error: `unsupported content type "${file.type}" — JPEG or PNG only` }, 400);
  }
  if (file.size > RECEIPT_UPLOAD_MAX_BYTES) {
    return c.json({ error: `file exceeds the ${RECEIPT_UPLOAD_MAX_BYTES}-byte upload cap` }, 413);
  }

  const receiptId = crypto.randomUUID();
  const uploadedAt = new Date();
  const nowIsoStr = uploadedAt.toISOString();
  const r2Key = receiptR2Key(user.userId, uploadedAt, receiptId);

  await c.env.RECEIPTS.put(r2Key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });

  const sourceId = `photo:${user.userId}`;
  const receiptSourceId = crypto.randomUUID();

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO sources (id, type, auth_state) VALUES (?, 'photo', 'not_applicable')
       ON CONFLICT (id) DO NOTHING`,
    ).bind(sourceId),
    c.env.DB.prepare(
      `INSERT INTO receipts (id, r2_key, status, created_at, updated_at)
       VALUES (?, ?, 'pending', ?, ?)`,
    ).bind(receiptId, r2Key, nowIsoStr, nowIsoStr),
    c.env.DB.prepare(
      `INSERT INTO receipt_sources (id, receipt_id, source_id, external_id, ingested_at)
       SELECT ?, ?, ?, NULL, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM receipt_sources WHERE receipt_id = ? AND source_id = ? AND external_id IS NULL
        )`,
    ).bind(receiptSourceId, receiptId, sourceId, nowIsoStr, receiptId, sourceId),
  ]);

  const job: ExtractionJob = {
    receiptId,
    r2Key,
    userId: user.userId,
    modality: "vision",
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
  };
  await c.env.EXTRACTION_QUEUE.send(job);

  return c.json({ receiptId, status: "pending" }, 202);
});

/** `GET /api/receipts/:id` — status poll for `UploadForm.tsx`. Read-only,
 * scoped to the fields a poller needs (status only — not the full row). */
receiptsRoutes.get("/:id", async (c) => {
  const receiptId = c.req.param("id");
  const row = await c.env.DB.prepare(`SELECT status FROM receipts WHERE id = ?`)
    .bind(receiptId)
    .first<{ status: string }>();
  if (!row) {
    return c.json({ error: "no such receipt" }, 404);
  }
  return c.json({ receiptId, status: row.status });
});
