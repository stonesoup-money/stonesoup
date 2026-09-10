import { SELF } from "cloudflare:test";
import { PUBLIC_ROUTE_PATHS } from "@stonesoup/core";
import { describe, expect, it } from "vitest";

/**
 * SELF.fetch drives the real exported Worker handler (packages/worker/src/index.ts),
 * not the Hono sub-app in isolation — this is what actually proves a
 * request reaches app.route("/", publicPages) the way `wrangler dev`
 * would route it, and it is why this test suite, not the static
 * verifier alone, is what STON-13's plan calls for. It cannot prove
 * `run_worker_first` is honoured by the real assets config, though (the
 * Workers Vitest pool may not simulate that faithfully) — that is
 * scripts/verify-public-routes.mjs's job, not this file's.
 */

describe("public legal pages: reachable with no credentials", () => {
  it.each(PUBLIC_ROUTE_PATHS)("GET %s returns 200 html with no auth", async (path) => {
    const response = await SELF.fetch(`https://example.com${path}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")?.toLowerCase()).toContain("text/html");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it.each(PUBLIC_ROUTE_PATHS)(
    "GET %s carries no cookie header on the request either",
    async (path) => {
      // No `credentials: "include"`, no Cookie header set on the request —
      // this is the uncredentialed request STON-16/AGENTS.md requires to
      // succeed, the same way Google's consent-screen fetcher would call it.
      const response = await SELF.fetch(`https://example.com${path}`, {
        headers: {},
      });
      expect(response.status).toBe(200);
    },
  );
});

describe("public legal pages: content and safety headers", () => {
  it.each(PUBLIC_ROUTE_PATHS)("%s ships no <script> tag", async (path) => {
    const response = await SELF.fetch(`https://example.com${path}`);
    const body = await response.text();
    expect(body).not.toContain("<script");
  });

  it.each(PUBLIC_ROUTE_PATHS)("%s sets a tight CSP with no unsafe-inline", async (path) => {
    const response = await SELF.fetch(`https://example.com${path}`);
    const csp = response.headers.get("content-security-policy");
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain("unsafe-inline");
  });

  it.each(PUBLIC_ROUTE_PATHS)("%s sets nosniff and no-referrer", async (path) => {
    const response = await SELF.fetch(`https://example.com${path}`);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("links to the shared tokens.css stylesheet, not an inline <style>", async () => {
    const response = await SELF.fetch("https://example.com/privacy");
    const body = await response.text();
    expect(body).toContain('href="/tokens.css"');
    expect(body).not.toContain("<style>");
  });

  it("/privacy has the headline visible in the raw body", async () => {
    const response = await SELF.fetch("https://example.com/privacy");
    const body = await response.text();
    expect(body).toContain("Privacy Policy");
  });

  it("/terms has the headline visible in the raw body", async () => {
    const response = await SELF.fetch("https://example.com/terms");
    const body = await response.text();
    expect(body).toContain("Terms of Service");
  });

  it("/data-promise has the headline visible in the raw body", async () => {
    const response = await SELF.fetch("https://example.com/data-promise");
    const body = await response.text();
    expect(body).toContain("The Data Promise");
  });

  it("/privacy renders the Google user data and Limited Use section", async () => {
    const response = await SELF.fetch("https://example.com/privacy");
    const body = await response.text();
    expect(body).toContain("Google user data and Limited Use");
    expect(body).toContain("Limited Use");
  });

  it("cross-links between the three pages appear in the footer", async () => {
    const response = await SELF.fetch("https://example.com/privacy");
    const body = await response.text();
    expect(body).toContain('href="/terms"');
    expect(body).toContain('href="/data-promise"');
  });
});

describe("deployment-mode conditional rendering", () => {
  // This instance's wrangler.jsonc default is "self-hosted" — the default
  // config this test suite runs against. Rendering the hosted branch is
  // covered directly at the document level (packages/core/src/legal/documents.test.ts),
  // which exercises both LegalContext shapes without needing a second env.
  it("the default self-hosted deployment renders the self-hosted branch, with no placeholder", async () => {
    const response = await SELF.fetch("https://example.com/privacy");
    const body = await response.text();
    expect(body).toContain("self-hosted instance");
    expect(body).not.toContain("[[");
  });
});
