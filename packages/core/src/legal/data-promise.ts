import { GOLDEN_SET_CONTRIBUTION_DEFAULT } from "../config.js";
import type { LegalContext } from "./context.js";
import { LEGAL_LAST_UPDATED, UNBUILT_MARKER } from "./context.js";

/**
 * The data promise: the anonymization page, versioned in-repo (brief,
 * "Repo documents"). Distinct from the privacy policy — this document is
 * specifically about the one path that leaves an instance on purpose,
 * the golden-set label contribution, field by field.
 *
 * This document describes the committed design for the golden-set
 * submission path, including the parts not yet wired to a live endpoint
 * (the central submission endpoint is gated in this ticket — see
 * docs/dataset-publication.md and AGENTS.md's Human gates section). It
 * does not claim the endpoint is live; docs/privacy-claims.md tracks
 * exactly what is and is not implemented yet, and this file's rows there
 * must be kept current with whichever ticket wires the endpoint up.
 *
 * **This document is deployment-mode aware (review round 3, finding
 * 3).** It used to take `_ctx` and ignore it, so its hosted and
 * self-hosted renderings were byte-identical — which is precisely why
 * three review rounds of "check both modes" never surfaced the
 * contradiction it contained: this page told a hosted reader to see
 * /terms "for how to change it for this instance", and hosted /terms had
 * no opt-out to point at, because on the hosted free tier the labels
 * *are* the payment. Ignoring `ctx` was the bug, not a simplification.
 * "Turning contribution off" now renders the truth for the deployment
 * the reader is actually looking at.
 *
 * **The local row vs. the submission payload (review round 1, finding
 * 3).** Earlier drafts of this page described one list of fields as both
 * "what this instance writes locally" and "what leaves your machine" —
 * that conflation is false: the local `golden_set` row genuinely does
 * carry more than the submission payload (`id`, `created_at`,
 * `submitted_at`, and the real `labeler`), and a reader deserves the
 * actual boundary, not a rounded-off approximation of it. This file now
 * describes the two explicitly, and
 * packages/core/src/legal/submission-fields.ts is the single source both
 * this prose and packages/worker/src/public/policy-claims.test.ts's
 * exhaustiveness check read from, so the two cannot drift apart silently.
 *
 * **When `labeler` is pseudonymized (decisions.md, "when is `labeler`
 * pseudonymized?").** It happens at the **instance boundary — at
 * submission** — not at dataset export. The local row keeps the real
 * value (unchanged, still not stripped at write time); the submission
 * client substitutes a per-instance pseudonym before anything is sent, so
 * the raw value never sits in the central pot at all, let alone in a
 * published release.
 */
export function dataPromiseMarkdown(ctx: LegalContext): string {
  const isHosted = ctx.mode === "hosted";

  const turningOff = isHosted
    ? `Golden-set contribution defaults to \`${GOLDEN_SET_CONTRIBUTION_DEFAULT}\`, in both self-hosted and hosted deployments, clearly disclosed here rather than buried in a settings screen. **On this hosted service it is not optional.** The labels are what the free tier is paid with instead of money — that is the deal stated at [/terms](/terms), and there is no setting that switches it off. If you want your labels kept private, run your own instance of the same open-source code, where \`GOLDEN_SET_CONTRIBUTION\` can be set to \`"off"\`. Either way nothing is contributed today: the submission client described above does not exist ${UNBUILT_MARKER}.`
    : `Golden-set contribution defaults to \`${GOLDEN_SET_CONTRIBUTION_DEFAULT}\`, in both self-hosted and hosted deployments, clearly disclosed here rather than buried in a settings screen. On this self-hosted instance you can turn it off: set this instance's \`GOLDEN_SET_CONTRIBUTION\` value to \`"off"\` — see [/terms](/terms). That variable is real, but no code reads it yet ${UNBUILT_MARKER}, and nothing is contributed by any path today, because the submission client described above does not exist. On the hosted service the same default is not optional: there the labels are the free tier's payment.`;

  return `# The Data Promise

Stone Soup's whole reason to exist is a high-quality, honestly-collected labeled dataset of receipt line items. That only works if the promise about what leaves your machine is exact, not marketing. This page is that exactness.

**The local half of this page is real; the submission half has not happened yet.** This codebase writes a \`golden_set\` row on this instance when you confirm or correct a line item's category — see "The local record" below. It still contains no submission client, no central submission database, and no published dataset, so no label has ever left this instance. Sentences describing behaviour that does not exist carry the marker ${UNBUILT_MARKER} at the point of the claim, and \`docs/privacy-claims.md\` is the row-by-row status of every one of them. The design is published here before any label is collected, because a promise made afterwards is worth nothing.

## The local record

When you review a line item and confirm, correct, or skip it, this instance writes one row to its own \`golden_set\` table. That row is local — it is this instance's own review history and quality-control record, not the submission payload described below — and the table holds:

- **The raw line text**, exactly as printed on the receipt or in the order confirmation.
- **Merchant type** — a category like "grocery" or "pharmacy", not the merchant's name ${UNBUILT_MARKER}: this instance does not classify merchants yet, so this column is always empty today.
- **The model's guess**: its proposed category, subcategory, and confidence score.
- **Your verdict**: confirmed, corrected, or skipped, and the corrected category and subcategory if you changed them.
- **\`labeler\`** — an internal identifier for who made the labeling decision, kept for this instance's own quality control. It is not stripped when the record is written; see "The two boundaries" below for why, and for how it is handled before anything is submitted.
- **The routing reason** this item was surfaced for review (for example, low confidence, or a random audit).
- **\`taxonomy_version\` and \`schema_version\`** — which version of the category list and the record format produced this row.
- **\`split\`** — whether this record is assigned to the training, validation, or held-out test set, assigned once and never changed afterward ${UNBUILT_MARKER}: nothing assigns it yet, so it is always empty today.
- **An internal row ID, and the timestamp the row was written** (\`created_at\`) — this instance's own bookkeeping, not data designed to leave it. See "What actually leaves your machine" below for why the timestamp specifically stays local.

## What never leaves your machine

No receipt image. No receipt ID. No user ID. No store name. No purchase date or timestamp of the *purchase*. These are dropped **at write time** — they are never present in the local record to begin with, not fields that get stripped later. There is no way to join a golden-set record back to the receipt, the account, or the person it came from through these fields, because they were never written down. This one is structural and checkable today: those columns do not exist in the \`golden_set\` table, and a test reads the live schema to prove it.

Email bodies are handled the same way at the point they are parsed for receipt data: once a message's merchant, date, and line items are extracted, the body itself is discarded entirely, before a golden-set record is ever considered.

## What actually leaves your machine — the submission payload

If golden-set contribution is enabled, this instance's *submission client* prepares a separate payload from the local record above before anything is sent to Stone Soup's central submission service (see [/privacy](/privacy), "Third parties") ${UNBUILT_MARKER}. That payload is an explicit **allowlist** — only the fields named below are ever included, built field by field, never a raw copy of the local row. It contains exactly:

- The raw line text (\`raw_string\`).
- Merchant type (\`merchant_type\`).
- The model's guess: category (\`model_category\`), subcategory (\`model_subcategory\`), and confidence (\`model_confidence\`).
- Your verdict (\`verdict\`), and the corrected category (\`corrected_category\`) and subcategory (\`corrected_subcategory\`) if you changed them.
- The routing reason (\`routing_reason\`).
- \`taxonomy_version\` and \`schema_version\`.
- \`split\`.
- A **per-instance pseudonym**, substituted for the real \`labeler\` before the payload is built. The real value never leaves this instance — see "The two boundaries" below.

It never contains the local row's own **ID**, **\`created_at\`**, or **\`submitted_at\`** — none of these leave, not even coarsened, except that a deliberately coarsened value (a month, never a full timestamp) could be added to this allowlist explicitly in the future if a real analytical need for one ever arises. The reason is specific, not general caution: a precise, per-label timestamp sitting next to a per-labeler pseudonym in a dataset anyone can download is a re-identification handle — enough labels from one pseudonym, timestamped closely enough, start to look like a behavioral fingerprint. Dropping it is cheaper than ever having to explain why it should have been dropped.

**This submission client does not exist in this codebase yet** ${UNBUILT_MARKER}. The payload described above is committed design (STON-9, human-gated — see \`docs/dataset-publication.md\`); this repository does not read \`golden_set\` row contents, pseudonymize a labeler, or submit anything anywhere. \`docs/privacy-claims.md\` tracks this precisely, and the payload's field list is checked by a test against the real \`golden_set\` schema so that a column added later cannot silently start (or silently fail to start) leaving this instance without this page being updated first.

## The detail most privacy pages gloss over

The raw line text is designed to be submitted **exactly as printed** ${UNBUILT_MARKER} — that is the entire point of a golden set built from real receipts, and a paraphrased or normalized line would train a model on data that does not look like the real thing. Be aware that a printed receipt line often carries its own price alongside the item name ("ORGANIC BANANAS 1.24 LB @ .79/LB"), and, less often, promotional or loyalty text. The client-side filter described below is designed to screen out the categories of line most likely to be sensitive ${UNBUILT_MARKER}, but it screens for *pattern*, not for a guarantee that no printed line ever surprises you. If you see something on a receipt you would rather not contribute at all, skip that item during review instead of confirming or correcting it — a skipped item is never sent.

## The client-side filter

Before any label leaves your device, a filter is designed to run **on your machine**, not on a server: it would drop line items that match pharmacy-style patterns (prescription medication names, dosage strings) and anything that looks like a person's name, so those never leave in the first place ${UNBUILT_MARKER}. **This filter does not exist in this codebase yet** — it is planned as best-effort pattern matching, not a guarantee, once it is built. Until then nothing described in this section has actually screened a submitted label, because the submission client it would run inside does not exist either (see "What actually leaves your machine" above). Once it exists, if you believe a line slipped through that should not have, you will be able to report it (see this instance's contact details in [/privacy](/privacy)) so the filter's pattern table can be extended; the fix would apply going forward, but see "Publication" below for what that means for anything already released.

## The two boundaries — and why they are different

There are two separate anonymization mechanisms here, and they work at different times on purpose:

- **Context** (receipt ID, user ID, store, purchase timestamp, image reference) is dropped **at write**. It is never in a golden-set record to begin with, so there is nothing to remove later and nothing that a bug could "forget" to strip. This is the half that is real today — it is enforced by the absence of those columns from the schema.
- **Identity** (\`labeler\`) is the opposite: it is written and kept **locally**, deliberately, because a real internal identifier is what makes quality control (catching a mislabeling pattern from one source, for instance) possible at all. It is pseudonymized at the **instance boundary — at submission**, not at dataset export ${UNBUILT_MARKER}: before this instance's submission client sends anything, the real \`labeler\` is replaced with a per-instance pseudonym, so the raw value never sits in the central submission pot in the first place, let alone survives to a published release. The two are different problems: context never had a legitimate use once written, identity does, until the moment it would cross this instance's boundary.

## Open Receipts

The dataset this design leads to is named *Open Receipts*, a name of its own, deliberately separate from the Stone Soup product name. It is to be released under **CC0** — public domain, no restriction on use — with a citation request in the dataset card, stated here before any label is ever collected: if you use Open Receipts, please cite it. No dataset has been published and no label has been collected, so this is a commitment made in advance rather than a description of something you can download today ${UNBUILT_MARKER}. (A share-alike license like ODbL was considered and rejected: it would have discouraged exactly the machine-learning use the dataset exists to enable.)

## Publication: pot, ladle, table

**None of this publication pipeline exists** ${UNBUILT_MARKER} — there is no central submission database, no release script, and no published dataset. What follows is the committed design, in three stages, published in advance so it can be held against what is eventually built:

- **Pot.** Submission payloads — already pseudonymized, already stripped of \`id\`/\`created_at\`/\`submitted_at\`, per "What actually leaves your machine" above — would stream into a private, central submission database as they are made. By construction the pot would never receive a real \`labeler\` or a local timestamp: there is nothing left to anonymize by the time a record reaches it.
- **Ladle.** Publication would follow a fixed, public process that pulls from that pot, deduplicates, re-runs the client-side sensitive-string filter server-side as a second, independent check, assigns train/validation/test splits, computes the dataset card's statistics, and emits a versioned JSONL file. That release script is not written; when it is, it belongs in the separate \`open-receipts\` repository, published as public code with credentials excluded, so that anyone can read what the release process does to the data before it publishes.
- **Table.** The publication surface would be a tagged GitHub release in that repository — never the live submission database itself, which is never queried by or exposed to the public.

**Before every tagged release, a human maintainer looks at a sample of what is about to be published.** This is not a v1-only safeguard to be automated away later — it is permanent, by design, for as long as Open Receipts exists. No release has ever been made, so this commitment binds the first one rather than describing a habit. See \`docs/dataset-publication.md\` for the full description of this pipeline, its GO/GATED boundaries, and why this repository contains none of its code.

## Turning contribution off

${turningOff}

---

Last revised ${LEGAL_LAST_UPDATED}.
`;
}
