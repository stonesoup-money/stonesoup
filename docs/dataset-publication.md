# Dataset publication: pot, ladle, table

This document describes how *Open Receipts* — the anonymized, CC0-licensed
labeled dataset built from Stone Soup review verdicts — is published. It
is prose only. **No code in this repository implements any part of the
pipeline it describes**, by design (see "Why this repo has none of this
code" below).

## The three stages

**Pot.** As users review and confirm or correct line-item categories,
anonymized labels stream into a private, central submission database —
one Worker, one table, receiving only what `docs/data-promise.md`
describes (raw string, model guess, human verdict, and the small set of
other fields listed there — never a receipt image, receipt id, user id,
store, or purchase timestamp). This database is live and private. It is
never the publication surface itself.

**Ladle.** Publication follows a fixed, public process that:

1. pulls a batch of records from the pot;
2. deduplicates them;
3. pseudonymizes each record's `labeler` field (an opaque per-labeler
   token, or strips the field — the internal identifier that quality
   control needs is never published);
4. re-runs the sensitive-string filter **server-side**, as a second,
   independent check on top of the client-side filter every record
   already passed before it left a user's device;
5. assigns each record to a train/validation/test split (a record's
   split, once assigned anywhere in the pipeline, is never reassigned);
6. computes the dataset card's statistics (record counts, category
   distribution, taxonomy version coverage);
7. emits a versioned JSONL file.

The ladle is **public code**, published in the separate `open-receipts`
repository, with credentials excluded from that repository entirely. Its
being public and auditable is itself part of the trust claim: anyone can
read exactly what the release process does to the data before it
publishes.

**Table.** A maintainer runs the ladle locally, on a monthly cadence.
**Before every tagged release, that maintainer looks at a sample of what
is about to be published.** This is not a v1-only safeguard scheduled for
automation later — it is permanent, by design, for as long as Open
Receipts exists (see AGENTS.md, Human gates: "the human sample review
before every tagged release is permanent, not a v1 gate"). Only after
that review does the maintainer commit and tag a GitHub release. The
`open-receipts` repository is the publication surface; the live
submission database is never queried by, or exposed to, the public.

## Why this repo has none of this code

This ticket (STON-13) is explicitly gated on the publication pipeline: no
code that reads `golden_set`, dedupes, pseudonymizes labelers, assigns
splits, emits JSONL, tags a release, or talks to the central pot may be
written here — not a working version, not a disabled stub, not a
flag-gated path that a later change could flip on. See AGENTS.md, Human
gates, and STON-13's ticket description for the exact boundary. The only
database access this ticket's test suite makes against `golden_set` is a
single read-only `PRAGMA table_info(golden_set)` schema-introspection
query, in `packages/worker/src/public/policy-claims.test.ts` — proving
the anonymization boundary columns the privacy policy claims don't exist
really don't exist, not reading any row of actual label data.

The release script itself, when it is built, belongs in the separate
`open-receipts` repository — not this one — for the same reason the pot
and the ladle are described as separate stages above: this repository is
where user data lives and where the open-source product runs; the
publication surface for an already-anonymized, already-reviewed dataset
is a different codebase with a different trust boundary and no path back
to a Stone Soup deployment's live data.

## What would change this document

Building any part of the pipeline above — the central submission Worker
(STON-9's gated central endpoint), the ladle release script, or a
scheduled/manual release job — requires explicit, in-session human
instruction, per AGENTS.md's Human gates section. When that work is
authorized, this document should be updated to point at the ticket and
code that implements it, and `docs/privacy-claims.md`'s corresponding
rows should move from "gated / not yet implemented" to real evidence
pointers, in the same PR (AGENTS.md, "Public pages and the privacy
policy").
