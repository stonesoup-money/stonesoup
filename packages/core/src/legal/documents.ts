import type { LegalContext } from "./context.js";
import { dataPromiseMarkdown } from "./data-promise.js";
import { privacyMarkdown } from "./privacy.js";
import { termsMarkdown } from "./terms.js";

/**
 * The registry both the Hono route table (packages/worker/src/public/pages.ts)
 * and the static route verifier (scripts/verify-public-routes.mjs) read.
 * Nothing may define a public legal route that is not listed here — this
 * is the one place slug, path, title, and content are tied together.
 */
export interface LegalDocument {
  /** Stable identifier, also used as the docs/<slug>.md filename. */
  slug: string;
  /** The route path this document is served at. */
  path: string;
  /** Page title — used in <title> and the page <h1> fallback. */
  title: string;
  /** Renders this document's body as Markdown (see legal/markdown.ts) for a given deployment context. */
  markdown: (ctx: LegalContext) => string;
}

export const LEGAL_DOCUMENTS: readonly LegalDocument[] = [
  { slug: "privacy", path: "/privacy", title: "Privacy Policy", markdown: privacyMarkdown },
  { slug: "terms", path: "/terms", title: "Terms of Service", markdown: termsMarkdown },
  {
    slug: "data-promise",
    path: "/data-promise",
    title: "The Data Promise",
    markdown: dataPromiseMarkdown,
  },
];

/** The path list `wrangler.jsonc`'s `assets.run_worker_first` must contain
 * verbatim — see scripts/verify-public-routes.mjs. */
export const PUBLIC_ROUTE_PATHS: readonly string[] = LEGAL_DOCUMENTS.map((doc) => doc.path);

export function getLegalDocument(slug: string): LegalDocument | undefined {
  return LEGAL_DOCUMENTS.find((doc) => doc.slug === slug);
}
