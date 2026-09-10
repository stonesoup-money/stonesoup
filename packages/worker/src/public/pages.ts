import {
  DEFAULT_LEGAL_CONTEXT,
  type DeploymentMode,
  hasPlaceholderOperatorIdentity,
  LEGAL_DOCUMENTS,
  type LegalContext,
  PUBLIC_ROUTE_PATHS,
  renderMarkdown,
} from "@stonesoup/core";
import { Hono } from "hono";
import { html, raw } from "hono/html";

/**
 * Server-rendered public pages: /privacy, /terms, /data-promise. No JS,
 * no auth, no shadcn — a real 200 with real content in the first byte is
 * the whole point (STON-13 plan, "Why Worker-rendered HTML, not SPA
 * routes or static files"). This sub-app is deliberately unauthenticated
 * and must stay that way: STON-4 must exclude these three routes from
 * session middleware (a self-hoster's Google OAuth consent screen, and
 * this instance's own, fetch the privacy policy URL with no login), and
 * `wrangler.jsonc`'s `assets.run_worker_first` must keep listing all
 * three paths verbatim or `not_found_handling: "single-page-application"`
 * silently serves the SPA shell here instead — see
 * `scripts/verify-public-routes.mjs`, which is what actually guards that.
 */

/** The path list `wrangler.jsonc`'s `run_worker_first` must contain
 * verbatim, re-exported for the verifier script and for tests. */
// Exported for a direct unit test (packages/worker/src/public/pages.test.ts)
// that this actually gets called, rather than only trusting the review
// finding it fixes never regresses silently (review round 1, finding 4).
export { PUBLIC_ROUTE_PATHS, warnIfHostedIdentityUnfilled };

const KNOWN_MODES: readonly DeploymentMode[] = ["self-hosted", "hosted"];

function isDeploymentMode(value: string | undefined): value is DeploymentMode {
  return KNOWN_MODES.includes(value as DeploymentMode);
}

/** Builds this request's LegalContext from the Worker's env vars — the
 * one seam through which `DEPLOYMENT_MODE` / `OPERATOR_NAME` /
 * `OPERATOR_CONTACT` reach the document templates. Falls back to the
 * safe self-hosted default rather than throwing on a misconfigured or
 * missing var, since a misrendered-but-present policy page beats a 500
 * on the page Google's consent screen depends on. */
function legalContextFromEnv(env: Env): LegalContext {
  const mode = isDeploymentMode(env.DEPLOYMENT_MODE)
    ? env.DEPLOYMENT_MODE
    : DEFAULT_LEGAL_CONTEXT.mode;
  return {
    mode,
    // Falls back to the placeholder default, not "" — an unset var on a
    // hosted deployment must still render as visibly-not-ready, never as
    // a blank that could pass for an intentionally empty field.
    operatorName: env.OPERATOR_NAME || DEFAULT_LEGAL_CONTEXT.operatorName,
    operatorContact: env.OPERATOR_CONTACT || DEFAULT_LEGAL_CONTEXT.operatorContact,
  };
}

/** Logs a visible server-side warning the moment a hosted deployment is
 * about to serve one of these pages with its operator identity still
 * unfilled — the placeholder text in the rendered page (see context.ts's
 * `placeholder()`) is the reader-facing signal, this is the
 * deployer-facing one, so a hosted instance going live misconfigured is
 * loud in two places, not one (review round 1, finding 4). Deliberately
 * side-effecting only (no header, no response change): the page's own
 * `[[...]]` markers are the correctness guarantee, this is an
 * operational nudge on top of that guarantee, not a replacement for it. */
function warnIfHostedIdentityUnfilled(ctx: LegalContext): void {
  if (ctx.mode === "hosted" && hasPlaceholderOperatorIdentity(ctx)) {
    console.error(
      'Stone Soup: DEPLOYMENT_MODE is "hosted" but OPERATOR_NAME and/or ' +
        "OPERATOR_CONTACT is still unset — the public legal pages are rendering " +
        "placeholder text. Set both wrangler.jsonc vars before this instance " +
        "serves a real hosted user.",
    );
  }
}

function pageShell(title: string, bodyHtml: string) {
  const nav = LEGAL_DOCUMENTS.map((doc) => html`<a href="${doc.path}">${doc.title}</a>`);
  return html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title} — Stone Soup</title>
    <link rel="stylesheet" href="/tokens.css" />
    <link rel="stylesheet" href="/legal.css" />
  </head>
  <body>
    <header class="legal-header">
      <a class="legal-wordmark" href="/">Stone Soup</a>
    </header>
    <main class="legal-main">${raw(bodyHtml)}</main>
    <footer class="legal-footer">
      <nav aria-label="Legal pages">${nav}<a href="/">Back to Stone Soup</a></nav>
    </footer>
  </body>
</html>
`;
}

export const publicPages = new Hono<{ Bindings: Env }>();

for (const doc of LEGAL_DOCUMENTS) {
  publicPages.get(doc.path, async (c) => {
    const ctx = legalContextFromEnv(c.env);
    warnIfHostedIdentityUnfilled(ctx);
    const bodyHtml = renderMarkdown(doc.markdown(ctx));
    const page = await pageShell(doc.title, bodyHtml);

    // These pages ship no script and no third-party resource of any
    // kind, so the tightest CSP that still lets them render is
    // trivially satisfiable — see AGENTS.md and the STON-13 plan.
    c.header(
      "content-security-policy",
      "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'",
    );
    c.header("x-content-type-options", "nosniff");
    c.header("referrer-policy", "no-referrer");
    c.header("cache-control", "public, max-age=300");

    return c.html(page.toString());
  });
}
