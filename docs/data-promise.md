# The Data Promise

Stone Soup's whole reason to exist is a high-quality, honestly-collected labeled dataset of receipt line items. That only works if the promise about what leaves your machine is exact, not marketing. This page is that exactness.

## What leaves your machine

When you review a line item and confirm or correct its category, this instance may contribute one record to *Open Receipts* (see below) containing exactly these fields, and nothing else:

- **The raw line text**, exactly as printed on the receipt or in the order confirmation.
- **Merchant type** — a category like "grocery" or "pharmacy", not the merchant's name.
- **The model's guess**: its proposed category, subcategory, and confidence score.
- **Your verdict**: confirmed, corrected, or skipped, and the corrected category if you changed it.
- **`labeler`** — an internal identifier for who made the labeling decision, kept for quality control. It is not stripped when the record is written; see "The two boundaries" below for why, and how it is handled before publication.
- **The routing reason** this item was surfaced for review (for example, low confidence, or a random audit).
- **`taxonomy_version` and `schema_version`** — which version of the category list and the record format produced this row.
- **`split`** — whether this record is assigned to the training, validation, or held-out test set, assigned once and never changed afterward.

## What never leaves your machine

No receipt image. No receipt ID. No user ID. No store name. No purchase date or timestamp. These are dropped **at write time** — they are never present in the record to begin with, not fields that get stripped later. There is no way to join a golden-set record back to the receipt, the account, or the person it came from, because the join key was never written down.

Email bodies are handled the same way at the point they are parsed for receipt data: once a message's merchant, date, and line items are extracted, the body itself is discarded entirely, before a golden-set record is ever considered.

## The detail most privacy pages gloss over

The raw line text is submitted **exactly as printed** — that is the entire point of a golden set built from real receipts, and a paraphrased or normalized line would train a model on data that does not look like the real thing. Be aware that a printed receipt line often carries its own price alongside the item name ("ORGANIC BANANAS 1.24 LB @ .79/LB"), and, less often, promotional or loyalty text. The client-side filter below screens out the categories of line most likely to be sensitive, but it screens for *pattern*, not for a guarantee that no printed line ever surprises you. If you see something on a receipt you would rather not contribute at all, skip that item during review instead of confirming or correcting it — a skipped item is never sent.

## The client-side filter

Before any label leaves your device, a filter runs **on your machine**, not on a server: it drops line items that match pharmacy-style patterns (prescription medication names, dosage strings) and anything that looks like a person's name, so those never leave in the first place. This filter is best-effort pattern matching, not a guarantee — it is the densest, most heavily tested piece of logic in this codebase precisely because it is the last line of defense before data leaves your control. If you believe a line slipped through that should not have, report it (see this instance's contact details in [/privacy](/privacy)) so the filter's pattern table can be extended; the fix applies going forward, but see "Publication" below for what that means for anything already released.

## The two boundaries — and why they are different

There are two separate anonymization mechanisms here, and they work at different times on purpose:

- **Context** (receipt ID, user ID, store, purchase timestamp, image reference) is dropped **at write**. It is never in a golden-set record to begin with, so there is nothing to remove later and nothing that a bug could "forget" to strip.
- **Identity** (`labeler`) is the opposite: it is written and kept, deliberately, because a real internal identifier is what makes quality control (catching a mislabeling pattern from one source, for instance) possible at all. It is pseudonymized only at **export** — when a batch of records is prepared for publication, each labeler is replaced with an opaque, per-labeler pseudonym, or the field is stripped, before anything leaves the private submission database. The two are different problems: context never had a legitimate use once written, identity does, until the moment of publication.

## Open Receipts

The published dataset is *Open Receipts*, a name of its own, deliberately separate from the Stone Soup product name. It is released under **CC0** — public domain, no restriction on use — with a citation request in the dataset card, stated here before any label is ever collected: if you use Open Receipts, please cite it. (A share-alike license like ODbL was considered and rejected: it would have discouraged exactly the machine-learning use the dataset exists to enable.)

## Publication: pot, ladle, table

Labels stream into a private, central submission database as they are made — the "pot." Publication follows a fixed, public process — the "ladle" — that pulls from that pot, deduplicates, pseudonymizes labelers, re-runs the client-side sensitive-string filter server-side as a second check, assigns train/validation/test splits, and computes the dataset card's statistics, emitting a versioned JSONL file. That release script is public code, in the separate `open-receipts` repository, with credentials excluded — the "table" is a tagged GitHub release, never the live submission database itself.

**Before every tagged release, a human maintainer looks at a sample of what is about to be published.** This is not a v1-only safeguard to be automated away later — it is permanent, by design, for as long as Open Receipts exists. See `docs/dataset-publication.md` for the full description of this pipeline, its GO/GATED boundaries, and why this repository contains none of its code.

## Turning contribution off

Golden-set contribution defaults to `on`, in both self-hosted and hosted deployments, clearly disclosed here rather than buried in a settings screen — see [/terms](/terms) for how to change it for this instance.

---

Last revised 2026-09-10.
