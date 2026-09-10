import {
  DEFAULT_LEGAL_CONTEXT,
  DEFAULT_OPERATOR_CONTACT,
  DEFAULT_OPERATOR_NAME,
  getLegalDocument,
  type LegalContext,
} from "@stonesoup/core";
import { describe, expect, it } from "vitest";
import dataPromiseHostedCommitted from "../../../docs/data-promise.hosted.md?raw";
import dataPromiseCommitted from "../../../docs/data-promise.md?raw";
import privacyHostedCommitted from "../../../docs/privacy.hosted.md?raw";
import privacyCommitted from "../../../docs/privacy.md?raw";
import termsHostedCommitted from "../../../docs/terms.hosted.md?raw";
import termsCommitted from "../../../docs/terms.md?raw";

/**
 * Doc drift check (STON-13 plan): docs/*.md are committed copies of the
 * same Markdown source packages/worker/src/public/pages.ts renders at
 * request time — they exist so the policy is readable in the repo
 * (GitHub, a clone) without running the Worker, but a second copy that
 * silently stops matching the source of truth would be worse than no
 * copy at all. This runs in the `web` Vitest project specifically
 * because Vite's `?raw` import query works here; the `worker` project's
 * Workers-runtime transform may not support it (see vitest.config.ts).
 *
 * The `docs/*.hosted.md` copies (review round 1, finding 9) exist
 * because the self-hosted-only copies above are the *safe* rendering —
 * the hosted document is where a real hosted deployment's actual legal
 * exposure lives, and before this it could only be read by running code
 * (`getLegalDocument(slug).markdown(hostedCtx)`), never by opening a file
 * in the repo or on GitHub. Rendered with the same unfilled-placeholder
 * `LegalContext` `packages/core/src/legal/documents.test.ts` already
 * uses for its own hosted-mode assertions, so the committed hosted copy
 * shows exactly what a hosted deployment renders before a human fills in
 * the operator identity — placeholders and all, not fabricated facts.
 *
 * Regenerate a drifted file with:
 *   node_modules/.bin/esbuild packages/core/src/index.ts --bundle \
 *     --format=esm --platform=node --outfile=/tmp/core-bundle.mjs
 *   then a small script importing { getLegalDocument, DEFAULT_LEGAL_CONTEXT,
 *   DEFAULT_OPERATOR_NAME, DEFAULT_OPERATOR_CONTACT } from that bundle,
 *   rendering each doc for both DEFAULT_LEGAL_CONTEXT and a
 *   { mode: "hosted", operatorName: DEFAULT_OPERATOR_NAME, operatorContact:
 *   DEFAULT_OPERATOR_CONTACT } context, and writing docs/<slug>.md /
 *   docs/<slug>.hosted.md verbatim (see git history for the STON-13
 *   generation script this followed).
 */
const hostedUnfilledContext: LegalContext = {
  mode: "hosted",
  operatorName: DEFAULT_OPERATOR_NAME,
  operatorContact: DEFAULT_OPERATOR_CONTACT,
};

describe("docs/*.md match the rendered self-hosted markdown exactly", () => {
  it("docs/privacy.md", () => {
    expect(privacyCommitted).toBe(getLegalDocument("privacy")?.markdown(DEFAULT_LEGAL_CONTEXT));
  });

  it("docs/terms.md", () => {
    expect(termsCommitted).toBe(getLegalDocument("terms")?.markdown(DEFAULT_LEGAL_CONTEXT));
  });

  it("docs/data-promise.md", () => {
    expect(dataPromiseCommitted).toBe(
      getLegalDocument("data-promise")?.markdown(DEFAULT_LEGAL_CONTEXT),
    );
  });
});

describe("docs/*.hosted.md match the rendered hosted markdown exactly (review round 1, finding 9)", () => {
  it("docs/privacy.hosted.md", () => {
    expect(privacyHostedCommitted).toBe(
      getLegalDocument("privacy")?.markdown(hostedUnfilledContext),
    );
  });

  it("docs/terms.hosted.md", () => {
    expect(termsHostedCommitted).toBe(getLegalDocument("terms")?.markdown(hostedUnfilledContext));
  });

  it("docs/data-promise.hosted.md", () => {
    expect(dataPromiseHostedCommitted).toBe(
      getLegalDocument("data-promise")?.markdown(hostedUnfilledContext),
    );
  });
});
