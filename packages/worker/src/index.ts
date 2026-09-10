import {
  DEFAULT_EXTRACTION_MODEL,
  type ExtractionClient,
  type ExtractionJob,
} from "@stonesoup/core";
import { Hono } from "hono";
import { withSession } from "./auth/session.js";
import { validateAnthropicKey } from "./byok/validate.js";
import { createAnthropicExtractionClient } from "./extraction/anthropic-client.js";
import { processExtractionJob } from "./extraction/consumer.js";
import { createFixtureExtractionClient } from "./extraction/fixture-client.js";
import { publicPages } from "./public/pages.js";
import { receiptsRoutes } from "./receipts/upload.js";
import { reviewRoutes } from "./review/routes.js";

/**
 * Single deployable: this Worker serves the API under /api/* (and, in
 * later tickets, /mcp, /auth, /.well-known for MCP OAuth discovery); every
 * other path is served as a static asset by the `ASSETS` binding without
 * ever reaching this fetch handler (see `run_worker_first` in
 * wrangler.jsonc). No separate frontend host, no CORS.
 */
const app = new Hono<{ Bindings: Env }>();

// "Hardcoded auth is fine" (STON-2) — PUBLIC_API_PATHS (currently just
// /api/health) skips this inside the middleware itself; see
// packages/worker/src/auth/session.ts. Mounted on /api/* only — never in
// front of the public legal pages below (AGENTS.md).
app.use("/api/*", withSession);

app.get("/api/health", (c) => c.json({ ok: true }));

// Public, unauthenticated legal pages: /privacy, /terms, /data-promise.
// Deliberately mounted with no auth middleware — Google's OAuth consent
// screen (and a self-hoster's own) fetches the privacy policy URL with no
// login, and STON-4 must not wrap these routes in session middleware
// later (AGENTS.md, "Public pages and the privacy policy").
app.route("/", publicPages);

// BYOK status — format + model checks only (no live extraction call) on a
// routine poll. Onboarding wires a `runTestMessage` call in STON-5.
//
// ANTHROPIC_MODEL falls back to @stonesoup/core's DEFAULT_EXTRACTION_MODEL
// rather than assuming wrangler.jsonc's `vars` always supplies it — the
// single named export is the source of truth (AGENTS.md, "Config values,
// not hardcodes"; review round 1, finding 13), not an assumption that a
// deploy's env always sets it.
app.get("/api/byok/status", async (c) => {
  const status = await validateAnthropicKey({
    ANTHROPIC_API_KEY: c.env.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: c.env.ANTHROPIC_MODEL || DEFAULT_EXTRACTION_MODEL,
  });
  return c.json(status);
});

app.route("/api/receipts", receiptsRoutes);
app.route("/api/review", reviewRoutes);

/**
 * Round 2, finding 1 (Review invariant 6): `queue()` below used to build a
 * real Anthropic client unconditionally. The Workers Vitest pool loads
 * `env.ANTHROPIC_API_KEY` from a contributor's own `.dev.vars` (it logs
 * "Using secrets defined in .dev.vars"), and `receipts/upload.test.ts`'s
 * `SELF.fetch(POST /api/receipts)` calls enqueue onto the real
 * `EXTRACTION_QUEUE` — so a test reaching `queue()` by any path, direct or
 * via the local queue simulator, could fire a live vision call on that
 * key. `EXTRACTION_TEST_FIXTURE_CLIENT` is the guard: `vitest.config.ts`'s
 * `miniflare.bindings` is the only place that ever sets it (never
 * `wrangler.jsonc`, never `.dev.vars`), so this is a positive test-mode
 * signal, not a guess from an absent key. Under it, the client resolves
 * to `createFixtureExtractionClient` with a deliberately invalid result —
 * it never touches the network, and its failure path (mark the receipt
 * `failed`) is the same one `consumer.test.ts`'s malformed-result test
 * already exercises.
 */
function resolveExtractionClient(env: {
  ANTHROPIC_API_KEY: string;
  ANTHROPIC_MODEL: string;
  EXTRACTION_TEST_FIXTURE_CLIENT?: string;
}): ExtractionClient {
  if (env.EXTRACTION_TEST_FIXTURE_CLIENT) {
    return createFixtureExtractionClient({ __testOnly: "EXTRACTION_TEST_FIXTURE_CLIENT" });
  }
  return createAnthropicExtractionClient({
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: env.ANTHROPIC_MODEL,
  });
}

export default {
  fetch: app.fetch,

  // Gmail incremental sync cron trigger — implemented in STON-6.
  async scheduled(_event, _env, _ctx) {},

  // Extraction queue consumer (AGENTS.md, Pipeline rules: "extraction is
  // never inline — always through Queues"). `max_batch_size: 1` in
  // wrangler.jsonc means `batch.messages` always has exactly one message;
  // the loop below still processes generically. A failure marks the
  // receipt `failed` (inside `processExtractionJob`) and retries the
  // message explicitly, up to `max_retries: 3` before the configured DLQ.
  async queue(batch, env, _ctx) {
    const client = resolveExtractionClient(env);
    for (const message of batch.messages) {
      try {
        await processExtractionJob(env, message.body as ExtractionJob, client);
        message.ack();
      } catch (error) {
        console.error("extraction queue consumer failed", error);
        message.retry();
      }
    }
  },
} satisfies ExportedHandler<Env>;
