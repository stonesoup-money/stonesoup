# Architecture

Stone Soup is one Cloudflare Worker. That is the whole deployment: the API,
the static frontend, the queue consumer, the cron handler, and (later) the
MCP endpoint all ship as a single unit, from a single `wrangler deploy`.

This document describes what exists. Where something is designed but not
built, it says so.

## Shape

```
/
  wrangler.jsonc          the one Worker: routes, bindings, vars, cron
  migrations/             D1 schema, applied in order
  packages/
    core/    @stonesoup/core     pure TS — no DOM, no Workers types
    worker/  @stonesoup/worker   Hono app, queue consumer, scheduled()
    web/     @stonesoup/web      Vite + React SPA → dist, served by ASSETS
```

`core` is the shared middle. It holds the taxonomy, the money and date
helpers, the checksum rule, the dedupe rule, the extraction contract, the
config constants, and the legal document sources. It deliberately has
neither DOM types nor Workers types, which is what lets both the browser and
the Worker import it — enforced by tsconfig rather than by review.

`worker` and `web` stay separate packages because their type environments
(`@cloudflare/workers-types` versus `DOM`) and build tools (esbuild via
wrangler versus Vite) are mutually exclusive under strict typechecking.

There is no `packages/mcp`. MCP will be a route on the Worker, not a package.

## How a request is routed

`wrangler.jsonc` sets `assets.not_found_handling: "single-page-application"`,
so by default any unmatched path is answered with the SPA's `index.html`
**without the Worker running at all**. `assets.run_worker_first` is the
explicit list of paths that reach the Worker instead:

- `/api/*` — the JSON API, behind session middleware
- `/mcp`, `/mcp/*`, `/.well-known/*` — reserved for the MCP server
- `/auth/*` — reserved for the OAuth flow
- `/privacy`, `/terms`, `/data-promise` — server-rendered legal pages

Those last three matter more than they look. Google's OAuth consent screen
fetches the privacy policy URL with no login, and if the path fell through to
the SPA shell, Google would receive an empty JS app instead of a policy — a
silent failure that would block the consent screen with no visible error.
`scripts/verify-public-routes.mjs` fails `pnpm check` if the route list and
the document registry ever disagree, because a test alone can't prove it (the
Workers test pool may not simulate `run_worker_first` faithfully).

Serving the frontend from the same Worker is also why there is no CORS
configuration anywhere: the SPA and the API are the same origin.

## Data model

Six tables, in `migrations/0001_initial_schema.sql`:

| Table | Holds |
| -- | -- |
| `sources` | An ingestion source — a Gmail connection, or photo upload |
| `receipts` | One purchase: merchant, date, stated totals, status |
| `receipt_sources` | Join table — one receipt, many sources |
| `line_items` | One printed line: raw text, normalized text, category |
| `review_queue` | Lines routed to a human, and their resolution |
| `golden_set` | The label record a verdict produces |

Four conventions are enforced by the database rather than by convention:

**Money is integer cents, always.** Every money column is `*_cents` with a
CHECK that rejects what SQLite's INTEGER affinity would otherwise silently
accept. Never a float, never a preformatted string — formatting happens at
the render edge only.

**Dates are ISO 8601 text.** SQLite has no date type, so a CHECK on every
timestamp column is the convention that replaces one.

**Raw receipt text is never overwritten.** `line_items.raw_text` and
`receipts.merchant_raw` are NOT NULL, and a BEFORE UPDATE trigger aborts any
attempt to change them. `raw`, `normalized`, and `category` are three
separate fields. The raw string is the golden set's input; overwriting it
destroys the dataset the product exists to build.

**`INSERT OR REPLACE` is banned outright.** REPLACE is DELETE+INSERT, so it
bypasses every BEFORE UPDATE trigger, including the raw-text guards. An
earlier attempt to block it with guard triggers didn't work — the pragma it
relied on lives in the connection, not the database file, so it was off for
every real request in production. The defense is now two-layered: `ON DELETE
RESTRICT` on the foreign keys a REPLACE-induced delete would cascade
through, and `scripts/verify-no-replace.mjs` in `pnpm check`, which is what
actually stops it, at author time. Use `ON CONFLICT (...) DO UPDATE` instead.

`line_items` also ships four embedding columns — `embedding`,
`embedding_model`, `embedding_version`, `dims` — nullable and unpopulated
from day one. Embeddings are phase two; shipping the columns now means
enabling novelty-based routing later is a backfill rather than a migration.

## The photo pipeline

```
POST /api/receipts
  → R2 put at {userId}/{yyyy}/{mm}/{receiptUuid}
  → receipts row (status: pending)
  → enqueue ExtractionJob
        ⇣  (queue — never inline)
  queue() consumer
  → ExtractionClient.extract(image)      one vision call, whole receipt
  → parse + validate against the JSON schema
  → checksum: |Σ line_items + tax − stated_total| ≤ tolerance
  → line_items rows, each carrying taxonomy_version
  → low-confidence lines → review_queue
```

Extraction is never inline. It always goes through Queues, with
`max_batch_size: 1`, three retries, and a dead-letter queue. A failure marks
the receipt `failed` rather than losing it.

The checksum tolerance is `max(2 cents, 0.5% of stated total)`, exported as
a named constant. Fees — CRV, bag fees, tips, delivery — are line items
carrying the `fees-adjustments` category, so they are already inside the sum;
adding them again is a bug the tests check for.

**One extraction contract, two modality nodes.** The vision node exists; the
text node for email bodies is planned. Both are meant to share the same
prompt family, the same output schema, and the same validation. There are
zero per-merchant parsers and there will not be any.

The model is reached through an `ExtractionClient` interface. The real
implementation talks to Anthropic; tests use a fixture client, wired through
a test-only binding that only the Vitest config ever sets. No test makes a
live model call.

## Review, and the golden set

A verdict is the product, not a by-product. When you resolve a review item,
the `golden_set` record is written **immediately**, in the same `db.batch()`
that resolves the queue row. There is no later job that walks the review
table — a design like that loses data on every partial write.

The statement order is the idempotency proof: the golden-set insert reads
first (pre-update values), the `line_items` update runs second, and the
`review_queue` update that clears the guard both of them depend on runs last.
A replayed or raced verdict therefore writes zero rows rather than
duplicating.

Every verdict writes a record, including a skip. A skip that wrote nothing
would make reviewer work permanently unrecoverable — gone from the queue, and
absent from the dataset, with no re-queue path.

The golden-set insert selects only from `review_queue` and `line_items`,
never from `receipts`. That isn't a filter; it means the receipt id, user id,
store, and purchase timestamp are not even in scope at the point the record
is built.

## The anonymization boundary

There are two boundaries, at two different stages, and conflating them is the
most common way to get this wrong.

**Context is dropped at write.** Image reference, receipt id, user id, store,
purchase timestamp — these are never in a `golden_set` row to begin with.

**Identity is pseudonymized at submission.** `labeler` is deliberately
written and kept locally: it's a real internal identifier used for quality
control. It is pseudonymized at the instance boundary, when a record is
submitted — not at dataset export, which would let raw values sit in the
central pot. Nulling `labeler` at write time looks like it satisfies the
first rule; it doesn't, and it's a bug.

A client-side filter runs before submission, so pharmacy-pattern items and
name-like strings never leave the user's machine. Submission itself is not
built — the interface exists, nothing is wired live.

## Open and closed

Everything a user's data touches lives in this repository. That's the point
of the open artifact: you can read every line of code that handles your
receipts.

A separate private control plane handles hosted-fleet provisioning. Nothing
here depends on it, and nothing here is written against it. The one seam is
the OAuth token exchange, which will sit behind an interface so that the
hosted variant is a different implementation rather than a rewrite.

There is also no admin view, anywhere — no route, page, or query through
which an operator could read a user's data. Per-tenant isolation makes that
structural rather than a policy.

## Config

Backfill window, routing levers, checksum tolerance, the queue budget, and
the default model string are each a single named export in
`packages/core/src/config.ts`, mirrored by a var in `wrangler.jsonc`.
`scripts/verify-config-single-source.mjs` fails the build if a wrangler var
has no matching export. Routing levers are tuned by hand — there is no
automatic feedback loop.

## Testing

Integration tests run against real local bindings — D1, R2, and Queues
through `@cloudflare/vitest-plugin`. The database is never mocked; a mocked
binding tests the mock. Component tests ride in the same Vitest run using
Testing Library and happy-dom. One Playwright smoke of the keyboard review
flow is planned separately, because it drives a real browser.

Test fixtures are synthetic. There are no real receipts in this repository —
no images, no verbatim real receipt text — and there never will be. The
real-receipt eval set is private.

`pnpm check` is the single gate: typecheck, lint, tests, and the verifier
scripts. CI runs that same command rather than enumerating its own steps, so
a tree that passes locally passes CI.
