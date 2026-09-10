import { DEFAULT_LEGAL_CONTEXT, getLegalDocument } from "@stonesoup/core";
import { describe, expect, it } from "vitest";
import dataPromiseCommitted from "../../../docs/data-promise.md?raw";
import privacyCommitted from "../../../docs/privacy.md?raw";
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
 * Regenerate a drifted file with:
 *   pnpm exec tsx -e '...' (see git history for the STON-13 generation
 *   script) — or by hand: render getLegalDocument(slug).markdown(DEFAULT_LEGAL_CONTEXT)
 *   for DEFAULT_LEGAL_CONTEXT and write it to docs/<slug>.md verbatim.
 */
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
