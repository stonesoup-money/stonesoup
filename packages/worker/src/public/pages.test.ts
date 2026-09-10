import { SELF } from "cloudflare:test";
import {
  DEFAULT_OPERATOR_CONTACT,
  DEFAULT_OPERATOR_NAME,
  PUBLIC_ROUTE_PATHS,
} from "@stonesoup/core";
import { describe, expect, it, vi } from "vitest";
import { warnIfHostedIdentityUnfilled } from "./pages.js";

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

describe("rendered public pages carry no literal markdown syntax (review round 2, finding 4)", () => {
  // Round 1, finding 7 fixed backticks and `---` leaking onto the live
  // pages, but round 1 never added a negative test proving the *class* of
  // bug was closed — only that those two specific characters were now
  // handled. Round 2 found the same class regressed through a third
  // character (single-asterisk emphasis, used by this PR's own "design —
  // not yet built" marker and asides like `*Open Receipts*`). This test
  // is the negative assertion that should have existed the first time:
  // it inspects the actual bytes a browser receives, not the renderer's
  // unit tests, so any future markdown syntax the renderer doesn't
  // understand yet (underscores, `#` inside a word, whatever comes next)
  // fails `pnpm check` here instead of shipping to the open internet.
  it.each(PUBLIC_ROUTE_PATHS)(
    "%s renders no unconverted markdown control characters",
    async (path) => {
      const response = await SELF.fetch(`https://example.com${path}`);
      const body = await response.text();
      // Strip real HTML tags first — a rendered `<a href="...">`,
      // `<strong>`, `<em>`, or `<code>` legitimately contains `<`, `>`, and
      // quotes; the check below is about markdown *syntax characters*
      // surviving as literal text between the tags, not about markup.
      const textOnly = body.replace(/<[^>]*>/g, "");

      expect(textOnly, "literal backtick found in rendered text").not.toContain("`");
      expect(textOnly, "literal ** found in rendered text (unconverted bold)").not.toContain("**");
      expect(textOnly, "literal * found in rendered text (unconverted emphasis)").not.toContain(
        "*",
      );
      expect(textOnly, "literal markdown link syntax found in rendered text").not.toMatch(
        /\]\([^)]*\)/,
      );
      expect(textOnly, "a standalone --- thematic-break line survived unrendered").not.toMatch(
        /^\s*-{3,}\s*$/m,
      );
    },
  );
});

describe("warnIfHostedIdentityUnfilled (review round 1, finding 4)", () => {
  // hasPlaceholderOperatorIdentity() existed in context.ts but was never
  // called anywhere in the repo before this fix. This proves the call
  // site pages.ts now has actually fires under the condition it exists
  // for, instead of just existing unused again under a different name.
  it("logs a warning when hosted mode still has the default operator identity", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnIfHostedIdentityUnfilled({
      mode: "hosted",
      operatorName: DEFAULT_OPERATOR_NAME,
      operatorContact: DEFAULT_OPERATOR_CONTACT,
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toContain("hosted");
    errorSpy.mockRestore();
  });

  it("does not warn when hosted mode has a real operator identity", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnIfHostedIdentityUnfilled({
      mode: "hosted",
      operatorName: "Stone Soup Hosting, Inc.",
      operatorContact: "privacy@example.com",
    });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("does not warn in self-hosted mode even with the default identity fields", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnIfHostedIdentityUnfilled({
      mode: "self-hosted",
      operatorName: "irrelevant in self-hosted mode",
      operatorContact: "irrelevant in self-hosted mode",
    });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
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
