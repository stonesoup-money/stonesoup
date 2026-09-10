import { DEFAULT_EXTRACTION_MODEL } from "@stonesoup/core";
import { Hono } from "hono";
import { validateAnthropicKey } from "./byok/validate.js";
import { publicPages } from "./public/pages.js";

/**
 * Single deployable: this Worker serves the API under /api/* (and, in
 * later tickets, /mcp, /auth, /.well-known for MCP OAuth discovery); every
 * other path is served as a static asset by the `ASSETS` binding without
 * ever reaching this fetch handler (see `run_worker_first` in
 * wrangler.jsonc). No separate frontend host, no CORS.
 */
const app = new Hono<{ Bindings: Env }>();

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

export default {
  fetch: app.fetch,

  // Gmail incremental sync cron trigger — implemented in STON-6.
  async scheduled(_event, _env, _ctx) {},

  // Extraction queue consumer — implemented in STON-5. Extraction is never
  // inline (AGENTS.md, Pipeline rules); this is the seam that guarantees
  // that structurally.
  async queue(_batch, _env, _ctx) {},
} satisfies ExportedHandler<Env>;
