import {
  LEGAL_LAST_UPDATED,
  type LegalContext,
  PLACEHOLDER_EFFECTIVE_DATE,
  PLACEHOLDER_JURISDICTION,
  UNBUILT_MARKER,
} from "./context.js";

/**
 * Terms of Service. Self-hosted mode states the AGPL-3.0 deal and stops —
 * there is no service to accept terms *for*, just software you run.
 * Hosted mode states the free-tier label deal plainly (brief: "hosted
 * free tier's 'payment' is golden-set contribution"). Neither mode
 * describes a paid private tier — it does not exist yet (v1 scope fence,
 * AGENTS.md) — and this document must not imply otherwise.
 *
 * **Review round 3, finding 1 — why the enforcement clauses are gone.**
 * Earlier drafts promised a hosted reader a monthly extraction budget in
 * the present tense, and then made that budget *enforceable*: Acceptable
 * Use forbade "circumventing the extraction budget or invite gating" and
 * Termination let the operator terminate an account that "abuses the
 * extraction budget" or "was created to evade invite gating". No budget
 * constant, config var, or metering code exists anywhere in this
 * repository, and neither does invite gating. Marking the promise
 * unbuilt while leaving the enforcement standing would have left a
 * document that lets an operator act against a user for abusing a limit
 * that does not exist — incoherent, not merely unbuilt. Both limits are
 * now disclosed as design in one place, with the marker, and neither is
 * a ground for suspension until the change that builds it also updates
 * this document (AGENTS.md, "Public pages and the privacy policy").
 *
 * **Review round 3, finding 3 — the opt-out referral loop.** /privacy
 * and /data-promise both used to point a hosted reader here "for how to
 * turn contribution off", and hosted mode had nothing to say about it:
 * on the hosted free tier the labels *are* the payment. Hosted mode now
 * says that in its own words, and names the real alternative (run your
 * own instance), so the two-hop referral ends somewhere truthful.
 */
export function termsMarkdown(ctx: LegalContext): string {
  const isHosted = ctx.mode === "hosted";

  const intro = isHosted
    ? `These terms cover the hosted Stone Soup service operated by ${ctx.operatorName} (contact: ${ctx.operatorContact}). By using this hosted instance, you agree to them.`
    : `This is a self-hosted instance of Stone Soup. There is no service provider here to make terms with — you deployed the software, or someone did on your behalf, and you (or they) operate it. This document states what the AGPL-3.0 license means for you as the operator, and the one behavior that carries over from the hosted deal even here: the golden-set contribution default.`;

  const theDeal = isHosted
    ? `## The hosted deal

This service is licensed by the free-tier label deal: using it at no charge means the labeled corrections you make while reviewing your receipts — never your receipt images, account identifiers, merchant names, or purchase dates, see [/data-promise](/data-promise) — are contributed to *Open Receipts*, a labeled dataset released publicly under CC0 with a citation request. **This submission path does not exist in this codebase yet** ${UNBUILT_MARKER} — until it is built, no label is actually contributed by any path; see [/data-promise](/data-promise) for exactly what this design does and does not include. That is the free tier's payment, not money. There is currently **no paid tier** that keeps your labels private; if one is introduced later, this document will say so plainly before it exists, not after.

On this hosted service, golden-set contribution is **not optional** — it is what you pay with instead of money, and there is no setting that turns it off. If you want your labels kept private, the alternative is to run your own instance of the same open-source code, where contribution can be switched off; see [/data-promise](/data-promise), "Turning contribution off". This is stated here rather than left for you to discover: it is the whole of the deal.

## Access limits, and what is not yet built

Two limits belong to this service's committed design, and **neither of them exists in this codebase today** ${UNBUILT_MARKER}:

- **Invite gating.** Access may require an invite code, or be limited to an email allowlist, while the underlying Google OAuth app remains in testing mode (a Google-imposed cap on the number of test users, not a Stone Soup limit).
- **A monthly extraction budget.** Each account is designed to have a monthly extraction cap; using it up would produce a plain "this month's budget is used" state rather than a charge. There is no charge either way — this service has no billing of any kind, and you never see a bill for compute you did not agree to.

Because neither limit is built, neither is enforced, and nothing in these terms lets ${ctx.operatorName} act against you for exceeding a limit that does not exist. Whichever change builds one of them updates this document and \`docs/privacy-claims.md\` in the same change, before it is enforced.`
    : `## The label-contribution default

Self-hosted deployments ship with golden-set contribution **on by default**, clearly disclosed here rather than left to a settings page nobody reads: the same anonymized labeling contribution design described at [/data-promise](/data-promise) applies to this instance too, unless you turn it off. **This submission path does not exist in this codebase yet** ${UNBUILT_MARKER} — until it is built, no label is actually contributed by any path. This is disclosed, not hidden, because pretending otherwise in an open-source project would be theatre — anyone can read the source and see the default.

To turn it off, set this instance's \`GOLDEN_SET_CONTRIBUTION\` configuration value to \`"off"\`. That variable is real — it is in this instance's \`wrangler.jsonc\` — but no code reads it yet ${UNBUILT_MARKER}, because the submission path it would switch off does not exist. See [/data-promise](/data-promise) for exactly what is and is not included when it is on.`;

  const licenseSection = `## License and warranty

Stone Soup's source code is licensed under the GNU Affero General Public License, version 3.0 (AGPL-3.0). ${
    isHosted
      ? `The service you are using is designed to run an unmodified copy of that same open-source code ${UNBUILT_MARKER} — no hosted service is running it yet. AGPL-3.0 entitles you to the corresponding source of whatever a network service you use is actually running: the project's own source is public, and ${ctx.operatorName} must supply the source of any modified version they deploy.`
      : `You may run, modify, and redistribute it under that license's terms, including its requirement that anyone you offer a modified version of this software to as a network service can obtain the corresponding source.`
  } The software is provided **without warranty of any kind**, to the fullest extent the law where you are permits — see the AGPL-3.0 text for the full disclaimer.`;

  const acceptableUse = isHosted
    ? `## Acceptable use

Use this service for your own personal receipt tracking. Do not use it to process receipts on behalf of people who have not agreed to this policy, and do not attempt to access another account's data.

## Termination

${ctx.operatorName} may suspend or terminate an account that violates acceptable use as stated above. You may stop using this service and disconnect any connected accounts (Gmail) at any time. **There is no account-deletion or per-receipt delete path in this application today, in either self-hosted or hosted mode** ${UNBUILT_MARKER} — see [/privacy](/privacy), "Retention and deletion," for exactly what that means and what is tracked as STON-18.

## Governing law

These terms are governed by the laws of ${PLACEHOLDER_JURISDICTION}. This document takes effect on ${PLACEHOLDER_EFFECTIVE_DATE} and was last revised on ${LEGAL_LAST_UPDATED}.`
    : `## Operating this instance

As the operator of a self-hosted instance, you decide who may use it and what they may do with it, subject to the AGPL-3.0 license terms above. This document was last revised on ${LEGAL_LAST_UPDATED}.`;

  return `# Terms of Service

${intro}

${theDeal}

${licenseSection}

${acceptableUse}
`;
}
