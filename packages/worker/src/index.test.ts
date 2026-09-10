import { env } from "cloudflare:test";
import type { ExtractionJob } from "@stonesoup/core";
import { describe, expect, it, vi } from "vitest";
import worker from "./index.js";

const DB = env.DB;
const RECEIPTS = env.RECEIPTS;

const TEST_USER_ID = "index-queue-test-user";

async function seedPendingReceipt(): Promise<{ receiptId: string; r2Key: string }> {
  await DB.prepare(
    `INSERT INTO sources (id, type, auth_state) VALUES (?, 'photo', 'not_applicable')
     ON CONFLICT (id) DO NOTHING`,
  )
    .bind(`photo:${TEST_USER_ID}`)
    .run();
  const receiptId = crypto.randomUUID();
  const r2Key = `${TEST_USER_ID}/2026/08/${receiptId}`;
  await DB.prepare(`INSERT INTO receipts (id, r2_key, status) VALUES (?, ?, 'pending')`)
    .bind(receiptId, r2Key)
    .run();
  await RECEIPTS.put(r2Key, new Uint8Array([1, 2, 3]), {
    httpMetadata: { contentType: "image/jpeg" },
  });
  return { receiptId, r2Key };
}

describe("queue() consumer client resolution (round 2, finding 1 — Review invariant 6)", () => {
  it("never builds a real Anthropic client when EXTRACTION_TEST_FIXTURE_CLIENT is set, even with an API key present", async () => {
    const { receiptId, r2Key } = await seedPendingReceipt();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const ack = vi.fn();
    const retry = vi.fn();
    const job: ExtractionJob = {
      receiptId,
      r2Key,
      userId: TEST_USER_ID,
      modality: "vision",
      schemaVersion: 1,
    };

    // `env` here already carries `EXTRACTION_TEST_FIXTURE_CLIENT: "1"`
    // (vitest.config.ts's `miniflare.bindings` — every worker test runs
    // under it). `ANTHROPIC_API_KEY` is overridden to a plausible-looking
    // but entirely fake value: if the guard in `resolveExtractionClient`
    // failed and a real Anthropic client were built, the SDK would
    // attempt an actual outbound request (this sandbox has no network
    // access) rather than failing synchronously on a missing key — which
    // would hang or error this test out instead of silently passing.
    const batch = {
      messages: [{ id: "msg-1", timestamp: new Date(), body: job, attempts: 1, ack, retry }],
      queue: "stonesoup-extraction",
      metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
      ackAll: vi.fn(),
      retryAll: vi.fn(),
    } as unknown as MessageBatch<unknown>;

    await worker.queue?.(
      batch,
      { ...env, ANTHROPIC_API_KEY: "sk-ant-not-a-real-key" },
      {} as ExecutionContext,
    );

    expect(ack).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledTimes(1);

    // The fixture path's failure is `parseExtractionResult` rejecting the
    // deliberately invalid fixture — a distinct, identifiable error from
    // anything the real Anthropic SDK would throw (a network or auth
    // error), which proves the fixture branch ran, not the real client.
    const wrapped = consoleError.mock.calls.find(
      ([message]) => message === "extraction queue consumer failed",
    );
    if (!wrapped)
      throw new Error('expected a console.error("extraction queue consumer failed", ...) call');
    expect(wrapped[1]).toBeInstanceOf(Error);
    expect((wrapped[1] as Error).message).toContain("malformed extraction result");

    const receipt = await DB.prepare(`SELECT status FROM receipts WHERE id = ?`)
      .bind(receiptId)
      .first<{ status: string }>();
    expect(receipt?.status).toBe("failed");

    consoleError.mockRestore();
  });
});
