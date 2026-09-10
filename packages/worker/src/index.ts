import { Hono } from "hono";
import { validateAnthropicKey } from "./byok/validate.js";

/**
 * Single deployable: this Worker serves the API under /api/* (and, in
 * later tickets, /mcp, /auth, /.well-known for MCP OAuth discovery); every
 * other path is served as a static asset by the `ASSETS` binding without
 * ever reaching this fetch handler (see `run_worker_first` in
 * wrangler.jsonc). No separate frontend host, no CORS.
 */
const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true }));

// BYOK status — format + model checks only (no live extraction call) on a
// routine poll. Onboarding wires a `runTestMessage` call in STON-5.
app.get("/api/byok/status", async (c) => {
  const status = await validateAnthropicKey(c.env);
  return c.json(status);
});

export default {
  fetch: app.fetch,

  // Gmail incremental sync cron trigger — implemented in STON-6.
  async scheduled(_event, _env, _ctx) {},

  // Extraction queue consumer — implemented in STON-5. Extraction is never
  // inline (AGENTS.md, Pipeline rules); this is the seam that guarantees
  // that structurally.
  async queue(_batch, _env, _ctx) {},
} satisfies ExportedHandler<Env>;
