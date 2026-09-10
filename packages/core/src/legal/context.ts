import {
  DEPLOYMENT_MODE_DEFAULT,
  OPERATOR_CONTACT_DEFAULT,
  OPERATOR_NAME_DEFAULT,
} from "../config.js";

/**
 * The facts every legal document on the public pages needs, and the
 * placeholders that stand in for the ones no agent may invent.
 *
 * A self-hosted instance needs no legal entity and no jurisdiction — a
 * self-hoster's data never reaches an operator, so the rendered documents
 * say exactly that instead of asking anyone to fill something in. The
 * hosted fleet is a real operator serving other people's data, and its
 * documents need facts only a human has: legal entity name, contact
 * address, governing jurisdiction, and effective date. Inventing any of
 * these would be fabricating a legal document (STON-13 plan) — so every
 * hosted-mode value below is an unmissable placeholder, never a guess,
 * until a human fills it in.
 *
 * There is deliberately no "hosted deletion mechanism" placeholder here.
 * Account/receipt deletion is not a per-deployment fact a human fills in
 * the way a jurisdiction is — it is a feature that does not exist in this
 * codebase at all yet (STON-18: the schema's FK graph is RESTRICT-only,
 * with no delete path for any table, hosted or self-hosted). A
 * placeholder here would read as "fill in your mechanism", misrepresenting
 * an unbuilt feature as a deployment detail; privacy.ts instead states the
 * "nothing exists yet" fact directly (review round 1, finding 4).
 */

export type DeploymentMode = "self-hosted" | "hosted";

export interface LegalContext {
  mode: DeploymentMode;
  operatorName: string;
  operatorContact: string;
}

// Sourced from packages/core/src/config.ts, the single named export each
// is paired with in scripts/verify-config-single-source.mjs — that
// script is what keeps these in sync with wrangler.jsonc's
// DEPLOYMENT_MODE / OPERATOR_NAME / OPERATOR_CONTACT vars. Re-exported
// here under the names the document templates (privacy.ts, terms.ts)
// import, so this module stays the one the templates depend on.
export const DEFAULT_DEPLOYMENT_MODE: DeploymentMode = DEPLOYMENT_MODE_DEFAULT;
export const DEFAULT_OPERATOR_NAME = OPERATOR_NAME_DEFAULT;
export const DEFAULT_OPERATOR_CONTACT = OPERATOR_CONTACT_DEFAULT;

function placeholder(label: string): string {
  return `[[${label} — a human must fill this in before this instance serves a hosted user — see docs/privacy-claims.md]]`;
}

// Not wired to a wrangler.jsonc var (only DEPLOYMENT_MODE, OPERATOR_NAME
// and OPERATOR_CONTACT are — see wrangler.jsonc and config.ts above)
// because a governing jurisdiction and an effective date are one-time
// legal/product decisions, not per-deployment config a self-hoster would
// ever set. They stay inline placeholders a human edits directly here
// when the hosted service is ready to launch.
export const PLACEHOLDER_JURISDICTION = placeholder("GOVERNING_JURISDICTION");
export const PLACEHOLDER_EFFECTIVE_DATE = placeholder("EFFECTIVE_DATE");

/**
 * ISO 8601 date this document *text* was last revised. This is not a
 * legal "effective date" for the hosted terms (that is its own
 * placeholder above — a business decision no agent can make); it is
 * simply when the prose here was last edited, which is true and known in
 * both deployment modes.
 */
export const LEGAL_LAST_UPDATED = "2026-09-10";

/**
 * The default an open-artifact checkout ships with: self-hosted, with the
 * operator fields present but unused (a self-hosted document never reads
 * them — see privacy.ts / terms.ts). A hosted deployment overrides `mode`
 * (via the `DEPLOYMENT_MODE` wrangler var) and, until a human sets the
 * real values, keeps rendering the placeholders — visibly not ready
 * rather than plausibly wrong.
 */
export const DEFAULT_LEGAL_CONTEXT: LegalContext = {
  mode: DEFAULT_DEPLOYMENT_MODE,
  operatorName: DEFAULT_OPERATOR_NAME,
  operatorContact: DEFAULT_OPERATOR_CONTACT,
};

/**
 * True until a human has replaced the operator placeholders with real
 * values. Used by packages/worker/src/public/pages.ts to log a visible
 * server-side warning when a hosted deployment is about to serve real
 * users with an unfilled operator identity — a second, operational
 * signal alongside the `[[...]]` marker already rendered into the page
 * text itself (review round 1, finding 4: this function existed but was
 * never called anywhere).
 */
export function hasPlaceholderOperatorIdentity(ctx: LegalContext): boolean {
  return (
    ctx.operatorName === DEFAULT_OPERATOR_NAME || ctx.operatorContact === DEFAULT_OPERATOR_CONTACT
  );
}
