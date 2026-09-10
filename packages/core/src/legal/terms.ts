import {
  LEGAL_LAST_UPDATED,
  type LegalContext,
  PLACEHOLDER_EFFECTIVE_DATE,
  PLACEHOLDER_JURISDICTION,
} from "./context.js";

/**
 * Terms of Service. Self-hosted mode states the AGPL-3.0 deal and stops —
 * there is no service to accept terms *for*, just software you run.
 * Hosted mode states the free-tier label deal plainly (brief: "hosted
 * free tier's 'payment' is golden-set contribution"). Neither mode
 * describes a paid private tier — it does not exist yet (v1 scope fence,
 * AGENTS.md) — and this document must not imply otherwise.
 */
export function termsMarkdown(ctx: LegalContext): string {
  const isHosted = ctx.mode === "hosted";

  const intro = isHosted
    ? `These terms cover the hosted Stone Soup service operated by ${ctx.operatorName} (contact: ${ctx.operatorContact}). By using this hosted instance, you agree to them.`
    : `This is a self-hosted instance of Stone Soup. There is no service provider here to make terms with — you deployed the software, or someone did on your behalf, and you (or they) operate it. This document states what the AGPL-3.0 license means for you as the operator, and the one behavior that carries over from the hosted deal even here: the golden-set contribution default.`;

  const theDeal = isHosted
    ? `## The hosted deal

This service is licensed by the free-tier label deal: using it at no charge means the labeled corrections you make while reviewing your receipts — never your receipt images, account identifiers, merchant names, or purchase dates, see [/data-promise](/data-promise) — are contributed to *Open Receipts*, a labeled dataset released publicly under CC0 with a citation request. That is the free tier's payment, not money. There is currently **no paid tier** that keeps your labels private; if one is introduced later, this document will say so plainly before it exists, not after.

Access to this hosted service may require an invite code or be limited to an allowlist while the underlying Google OAuth app remains in testing mode (a Google-imposed cap on the number of test users, not a Stone Soup limit). Each account has a monthly extraction budget, stated in the app; using more than your budget produces a plain "this month's budget is used" state rather than a surprise charge — there is no charge, because you never see a bill for compute you did not agree to.`
    : `## The label-contribution default

Self-hosted deployments ship with golden-set contribution **on by default**, clearly disclosed here rather than left to a settings page nobody reads: the same anonymized labeling contributions described in the hosted deal above apply to this instance too, unless you turn it off. This is disclosed, not hidden, because pretending otherwise in an open-source project would be theatre — anyone can read the source and see the default. To turn it off, set this instance's \`GOLDEN_SET_CONTRIBUTION\` configuration value to \`"off"\`; see [/data-promise](/data-promise) for exactly what is and is not included when it is on.`;

  const licenseSection = `## License and warranty

Stone Soup's source code is licensed under the GNU Affero General Public License, version 3.0 (AGPL-3.0). ${
    isHosted
      ? `The service you are using runs an unmodified copy of that same open-source code — you can read exactly what it does at the project's public repository.`
      : `You may run, modify, and redistribute it under that license's terms, including its requirement that anyone you offer a modified version of this software to as a network service can obtain the corresponding source.`
  } The software is provided **without warranty of any kind**, to the fullest extent the law where you are permits — see the AGPL-3.0 text for the full disclaimer.`;

  const acceptableUse = isHosted
    ? `## Acceptable use

Use this service for your own personal receipt tracking. Do not use it to process receipts on behalf of people who have not agreed to this policy, attempt to access another account's data, or attempt to circumvent the extraction budget or invite gating described above.

## Termination

${ctx.operatorName} may suspend or terminate an account that violates acceptable use, abuses the extraction budget, or was created to evade invite gating. You may stop using this service and disconnect any connected accounts (Gmail) at any time; see [/privacy](/privacy) for what happens to your data on account deletion.

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
