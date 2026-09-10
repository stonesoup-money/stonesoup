# The Data Promise

Stone Soup's whole reason to exist is a high-quality, honestly-collected labeled dataset of receipt line items. That only works if the promise about what leaves your machine is exact, not marketing. This page is that exactness.

## The local record

When you review a line item and confirm or correct its category, this instance writes one row to its own `golden_set` table *(design — not yet built; see docs/privacy-claims.md)*. That row is local — it is this instance's own review history and quality-control record, not the submission payload described below — and it contains:

- **The raw line text**, exactly as printed on the receipt or in the order confirmation.
- **Merchant type** — a category like "grocery" or "pharmacy", not the merchant's name.
- **The model's guess**: its proposed category, subcategory, and confidence score.
- **Your verdict**: confirmed, corrected, or skipped, and the corrected category and subcategory if you changed them.
- **`labeler`** — an internal identifier for who made the labeling decision, kept for this instance's own quality control. It is not stripped when the record is written; see "The two boundaries" below for why, and for how it is handled before anything is submitted.
- **The routing reason** this item was surfaced for review (for example, low confidence, or a random audit).
- **`taxonomy_version` and `schema_version`** — which version of the category list and the record format produced this row.
- **`split`** — whether this record is assigned to the training, validation, or held-out test set, assigned once and never changed afterward.
- **An internal row ID, and the timestamp the row was written** (`created_at`) — this instance's own bookkeeping, not data designed to leave it. See "What actually leaves your machine" below for why the timestamp specifically stays local.

## What never leaves your machine

No receipt image. No receipt ID. No user ID. No store name. No purchase date or timestamp of the *purchase*. These are dropped **at write time** — they are never present in the local record to begin with, not fields that get stripped later. There is no way to join a golden-set record back to the receipt, the account, or the person it came from through these fields, because they were never written down.

Email bodies are handled the same way at the point they are parsed for receipt data: once a message's merchant, date, and line items are extracted, the body itself is discarded entirely, before a golden-set record is ever considered.

## What actually leaves your machine — the submission payload

If golden-set contribution is enabled, this instance's *submission client* prepares a separate payload from the local record above before anything is sent to Stone Soup's central submission service (see [/privacy](/privacy), "Third parties"). That payload is an explicit **allowlist** — only the fields named below are ever included, built field by field, never a raw copy of the local row. It contains exactly:

- The raw line text (`raw_string`).
- Merchant type (`merchant_type`).
- The model's guess: category (`model_category`), subcategory (`model_subcategory`), and confidence (`model_confidence`).
- Your verdict (`verdict`), and the corrected category (`corrected_category`) and subcategory (`corrected_subcategory`) if you changed them.
- The routing reason (`routing_reason`).
- `taxonomy_version` and `schema_version`.
- `split`.
- A **per-instance pseudonym**, substituted for the real `labeler` before the payload is built. The real value never leaves this instance — see "The two boundaries" below.

It never contains the local row's own **ID**, **`created_at`**, or **`submitted_at`** — none of these leave, not even coarsened, except that a deliberately coarsened value (a month, never a full timestamp) could be added to this allowlist explicitly in the future if a real analytical need for one ever arises. The reason is specific, not general caution: a precise, per-label timestamp sitting next to a per-labeler pseudonym in a dataset anyone can download is a re-identification handle — enough labels from one pseudonym, timestamped closely enough, start to look like a behavioral fingerprint. Dropping it is cheaper than ever having to explain why it should have been dropped.

**This submission client does not exist in this codebase yet.** The payload described above is committed design (STON-9, human-gated — see `docs/dataset-publication.md`); this repository does not read `golden_set` row contents, pseudonymize a labeler, or submit anything anywhere. `docs/privacy-claims.md` tracks this precisely, and the payload's field list is checked by a test against the real `golden_set` schema so that a column added later cannot silently start (or silently fail to start) leaving this instance without this page being updated first.

## The detail most privacy pages gloss over

The raw line text is submitted **exactly as printed** — that is the entire point of a golden set built from real receipts, and a paraphrased or normalized line would train a model on data that does not look like the real thing. Be aware that a printed receipt line often carries its own price alongside the item name ("ORGANIC BANANAS 1.24 LB @ .79/LB"), and, less often, promotional or loyalty text. The client-side filter below screens out the categories of line most likely to be sensitive, but it screens for *pattern*, not for a guarantee that no printed line ever surprises you. If you see something on a receipt you would rather not contribute at all, skip that item during review instead of confirming or correcting it — a skipped item is never sent.

## The client-side filter

Before any label leaves your device, a filter is designed to run **on your machine**, not on a server: it would drop line items that match pharmacy-style patterns (prescription medication names, dosage strings) and anything that looks like a person's name, so those never leave in the first place *(design — not yet built; see docs/privacy-claims.md)*. **This filter does not exist in this codebase yet** — it is planned as best-effort pattern matching, not a guarantee, once it is built. Until then nothing described in this section has actually screened a submitted label, because the submission client it would run inside does not exist either (see "What actually leaves your machine" above). Once it exists, if you believe a line slipped through that should not have, you will be able to report it (see this instance's contact details in [/privacy](/privacy)) so the filter's pattern table can be extended; the fix would apply going forward, but see "Publication" below for what that means for anything already released.

## The two boundaries — and why they are different

There are two separate anonymization mechanisms here, and they work at different times on purpose:

- **Context** (receipt ID, user ID, store, purchase timestamp, image reference) is dropped **at write**. It is never in a golden-set record to begin with, so there is nothing to remove later and nothing that a bug could "forget" to strip.
- **Identity** (`labeler`) is the opposite: it is written and kept **locally**, deliberately, because a real internal identifier is what makes quality control (catching a mislabeling pattern from one source, for instance) possible at all. It is pseudonymized at the **instance boundary — at submission**, not at dataset export: before this instance's submission client sends anything, the real `labeler` is replaced with a per-instance pseudonym, so the raw value never sits in the central submission pot in the first place, let alone survives to a published release. The two are different problems: context never had a legitimate use once written, identity does, until the moment it would cross this instance's boundary.

## Open Receipts

The published dataset is *Open Receipts*, a name of its own, deliberately separate from the Stone Soup product name. It is released under **CC0** — public domain, no restriction on use — with a citation request in the dataset card, stated here before any label is ever collected: if you use Open Receipts, please cite it. (A share-alike license like ODbL was considered and rejected: it would have discouraged exactly the machine-learning use the dataset exists to enable.)

## Publication: pot, ladle, table

Submission payloads — already pseudonymized, already stripped of `id`/`created_at`/`submitted_at`, per "What actually leaves your machine" above — stream into a private, central submission database as they are made: the "pot." The pot never receives a real `labeler` or a local timestamp; there is nothing left to anonymize by the time a record reaches it. Publication follows a fixed, public process — the "ladle" — that pulls from that pot, deduplicates, re-runs the client-side sensitive-string filter server-side as a second check, assigns train/validation/test splits, and computes the dataset card's statistics, emitting a versioned JSONL file. That release script is public code, in the separate `open-receipts` repository, with credentials excluded — the "table" is a tagged GitHub release, never the live submission database itself.

**Before every tagged release, a human maintainer looks at a sample of what is about to be published.** This is not a v1-only safeguard to be automated away later — it is permanent, by design, for as long as Open Receipts exists. See `docs/dataset-publication.md` for the full description of this pipeline, its GO/GATED boundaries, and why this repository contains none of its code.

## Turning contribution off

Golden-set contribution defaults to `on`, in both self-hosted and hosted deployments, clearly disclosed here rather than buried in a settings screen — see [/terms](/terms) for how to change it for this instance.

---

Last revised 2026-09-10.
