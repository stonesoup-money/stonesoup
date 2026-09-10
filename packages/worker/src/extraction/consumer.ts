/**
 * The extraction queue consumer (AGENTS.md, Pipeline rules: "extraction is
 * never inline — always through Queues"). Wired into `packages/worker/src/index.ts`'s
 * `queue()` export. Per message: `status = 'extracting'` -> read the R2
 * object -> `client.extract(...)` -> `parseExtractionResult` ->
 * `persistExtraction` (which runs the checksum and `linkOrMerge`
 * internally). Failure sets `status = 'failed'` and the caller
 * (`index.ts`) calls `message.retry()`; `wrangler.jsonc` already declares
 * `max_batch_size: 1`, `max_retries: 3`, and a DLQ.
 *
 * `processExtractionJob` takes the client as a parameter rather than
 * constructing one — this is the seam that lets `consumer.test.ts` drive
 * it directly against real D1/R2 bindings with a fixture client (Review
 * invariant 6), and is also the fallback the ticket plan names if the
 * Workers Vitest pool cannot observe a real producer -> consumer trip: call
 * this exported entry directly with a hand-built job.
 *
 * Replay safety: `persistExtraction`'s `ON CONFLICT (id) DO NOTHING`
 * inserts (deterministic ids) mean running the same job twice writes no
 * duplicate rows — proved in `consumer.test.ts` by calling this function
 * twice with the same job.
 */

import {
  type ExtractionClient,
  type ExtractionInput,
  type ExtractionJob,
  nowIso,
  parseExtractionResult,
  TAXONOMY_VERSION,
} from "@stonesoup/core";
import { persistExtraction } from "./persist.js";

function base64FromArrayBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export interface ExtractionConsumerEnv {
  DB: D1Database;
  RECEIPTS: R2Bucket;
  CONFIDENCE_FLOOR?: string;
}

async function markFailed(db: D1Database, receiptId: string): Promise<void> {
  await db
    .prepare(`UPDATE receipts SET status = 'failed', updated_at = ? WHERE id = ?`)
    .bind(nowIso(), receiptId)
    .run();
}

export async function processExtractionJob(
  env: ExtractionConsumerEnv,
  job: ExtractionJob,
  client: ExtractionClient,
): Promise<void> {
  const db = env.DB;

  await db
    .prepare(`UPDATE receipts SET status = 'extracting', updated_at = ? WHERE id = ?`)
    .bind(nowIso(), job.receiptId)
    .run();

  const object = await env.RECEIPTS.get(job.r2Key);
  if (!object) {
    await markFailed(db, job.receiptId);
    throw new Error(
      `extraction consumer: R2 object not found at ${job.r2Key} (receipt ${job.receiptId})`,
    );
  }

  const mediaType = object.httpMetadata?.contentType ?? "image/jpeg";
  const dataBase64 = base64FromArrayBuffer(await object.arrayBuffer());
  const input: ExtractionInput =
    job.modality === "text"
      ? { modality: "text", text: "" }
      : { modality: "vision", image: { mediaType, dataBase64 } };

  let response: Awaited<ReturnType<ExtractionClient["extract"]>>;
  try {
    response = await client.extract(input, {
      schemaVersion: job.schemaVersion,
      taxonomyVersion: TAXONOMY_VERSION,
    });
  } catch (error) {
    await markFailed(db, job.receiptId);
    throw error;
  }

  const parsed = parseExtractionResult(response.result, {
    schemaVersion: job.schemaVersion,
    taxonomyVersion: TAXONOMY_VERSION,
  });

  if (!parsed.ok) {
    console.error(
      `extraction consumer: malformed extraction result for receipt ${job.receiptId}`,
      parsed.errors,
    );
    await markFailed(db, job.receiptId);
    throw new Error(
      `extraction consumer: malformed extraction result for receipt ${job.receiptId}`,
    );
  }

  // Round 2, finding 2: this used to run unguarded. A persist failure —
  // reachable via a model returning a malformed field the D1 CHECK
  // constraints reject (e.g. `payment_last4` as `"****4242"`), or via a
  // retry after partial success tripping the `merchant_raw` write-once
  // trigger (migration 0002) — left the receipt at `status = 'extracting'`
  // forever: the extraction discarded, the message off to the DLQ, and
  // `UploadForm`'s 2s poll with no ceiling. `markFailed` here matches the
  // same catch-and-fail pattern every other error path in this function
  // already uses.
  try {
    await persistExtraction(env, {
      receiptId: job.receiptId,
      userId: job.userId,
      sourceType: "photo",
      result: parsed.value,
      extractionModel: response.usage.model,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
    });
  } catch (error) {
    await markFailed(db, job.receiptId);
    throw error;
  }
}
