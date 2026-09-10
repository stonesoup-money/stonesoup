# Agent brief

Stone Soup is a self-hostable personal finance tool that answers
line-item-level spending questions transaction-level tools cannot. It
ingests receipts from Gmail and photo upload, extracts line items with
a vision model, normalizes them against a fixed taxonomy, and exposes
the data via an MCP server. TypeScript on Cloudflare Workers + Hono +
D1 + R2 + Queues, AGPL-3.0.

The *Stone Soup — v1 Engineering Brief* document on this project in
Linear is the authority on everything this file summarizes; STON-16
records the decisions made where the brief was silent. When a proposal
conflicts with the brief, the proposal loses or the brief is amended
deliberately — never by drift.

## This file

AGENTS.md is the only agent brief here. CLAUDE.md and GEMINI.md are
one-line `@AGENTS.md` imports, so every toolchain reads the same text
and there is nothing to keep in sync. Edit AGENTS.md; leave the two
stubs alone.

## House rules

- Boring, small, direct. New dependencies need a reason. Scope growth,
  speculative abstraction, and framework-building are bugs.
- v1 scope fence — building any of these is scope growth even when it
  looks small: Plaid + reconciliation, active novelty routing,
  visualization/chat agent, native app, multi-provider auth,
  multi-provider LLM support, review-gating economics, emergent
  taxonomy, merchant connections (Knot etc.).
- AGPL-3.0 from the first commit — relicensing later needs every
  contributor's consent, so it cannot be deferred.
- This repo is public. No secrets, keys, tokens, or credentials in any
  commit; no control-plane internals, unreleased commercial plans, or
  private-repo detail in code, comments, or commit messages.
- Everything a user's data touches lives in this repo (the open
  artifact). The control plane is a separate private repo and nothing
  here may depend on it.
- Config values, not hardcodes: backfill window (90 days), routing
  levers, checksum tolerance, default model string. Each is a single
  named export a human can retune in one place.
- No auto-deploy in v1. Deploys are a human `wrangler` command.
- Rebase onto current `origin/main` before opening or force-pushing a
  PR — other tickets merge concurrently.
- Filing a Linear ticket: set a priority and an estimate, your best
  judgment, stated once, not discussed.

## Data conventions

1. **Money is integer cents, always.** In D1, in extraction JSON,
   across every interface. Never a float, never a pre-formatted
   string. Format at the render edge only.
2. **Dates are ISO 8601 strings.** SQLite has no date type; this is
   the convention that replaces one.
3. **Never overwrite raw receipt text.** `raw`, `normalized`, and
   `category` are three separate fields. The raw string is the golden
   set's input — overwriting it destroys the dataset the product
   exists to build. This is the single most important rule in this
   file.
4. **Checksum tolerance**: a receipt passes when
   `|Σ line_items + tax + fees − stated_total| <= max(2 cents, 0.5% of stated_total)`,
   exported as one named constant (STON-16).
5. Every `line_items` row and every `golden_set` record carries
   `taxonomy_version`.

## Taxonomy

- Slugs are permanent IDs. **Additive-only** — never rename or
  repurpose a slug.
- Additions are a minor version bump. Moves are a major bump plus a
  migration map for golden-set records.
- v1 ships a **provisional** enumeration at `taxonomy_version: 0.1.0`,
  `status: provisional` (STON-16) — the human pass over real receipt
  lines adds slugs at 0.2.0 without a migration. That is exactly what
  additive-only buys.
- `fees-adjustments` catches non-product lines (CRV, bag fees, tips,
  delivery, standalone coupons) — without it every real receipt fails
  checksum. `other` is instrumentation: its usage rate signals a
  taxonomy gap, so never widen a category to avoid it.
- Picker keys 1–8 select the **eight first-level groups**; the second
  level is a follow-up narrowing step (STON-16 — the only reading
  under which "keys 1–8" and "~23 slugs" are both true).

## Privacy and the anonymization boundary

The section most at risk of an agent being helpfully wrong. Every rule
here gets its why.

- A `golden_set` record carries: raw string, merchant *type*, model
  guess + confidence, human verdict + corrected category, `labeler`,
  timestamp, routing reason, `taxonomy_version`, `schema_version`,
  `split`. It carries **no image reference, no receipt id, no user id,
  no store, no purchase timestamp**. Context is discarded at
  extraction — the boundary is at the write, not at the export.
- `labeler` **is written and kept locally on purpose.** It is a real
  internal identifier used for quality control, and it is
  pseudonymized at *export*, not stripped at write time. This is
  spelled out because it looks like a user id, so an agent reading the
  "no user id" rule will want to null it. Nulling it is a bug, not a
  fix (STON-16).
- `split` is assigned once and never changed. The held-out test set is
  never used for prompt tuning.
- The client-side filter runs **before** submission — pharmacy-pattern
  items and name-like strings never leave the user's machine. It gets
  the densest case table in the codebase; it is the privacy-critical
  path.
- **Email bodies are discarded entirely after parse.** Order
  confirmations carry addresses, names, and card last-4. Only
  merchant, date, totals, and line items survive.
- **No admin view, anywhere.** There must be no screen through which
  an operator can read a user's data. Per-tenant isolation makes this
  structural; do not add a surface that undoes it.
- **No real receipts in the repo, ever** — no images, no verbatim real
  receipt text in fixtures. Test fixtures are synthetic. The
  real-receipt eval set stays private.
- BYOK: the user's Anthropic key lives in Workers Secrets and nowhere
  else. Never log it, never persist it elsewhere, never send it
  anywhere but Anthropic.

## Design language

Grounded in the paper ledger and thermal receipt paper, not generic
warm-startup styling.

- Palette: paper `#FCFCF9` · ink `#1A1A17` · ledger-rule blue
  `#B9CCDD` · ledger red `#B3392E` · stamp green `#3E6B4F` · thermal
  grey `#6E6E66`. Once a token stylesheet exists (STON-2), it is
  canonical and this file quotes it — two copies of the same hexes
  will drift otherwise.
- **Ledger blue is structural ruling only — never text.** It is a
  hairline color; it does not pass as a foreground.
- **Ledger red is the single accent**: margin rule, attention counts,
  over-budget figures. Stamp green is confirmed verdicts. Nothing else
  earns a color.
- Type: **Bricolage Grotesque** for display and UI; **Spline Sans Mono**
  for every raw receipt string and every money figure, tabular,
  right-aligned.
- **Raw strings render exactly as printed** — exact case, mono,
  untrimmed. It is evidence, not copy. Title-casing, trimming, or
  prettifying a raw string for display is a bug.
- Structure: ledger ruling is the layout grammar. Horizontal hairlines
  for rows, one red vertical margin rule as the attention device.
  Left-aligned text, right-aligned money columns.
- **The review card is custom-built, not a themed shadcn `Card`.** It
  is the one bold element — receipt strip, mono raw line on thermal
  white, perforated top edge, verdict stamps. Everything else stays
  quiet.
- **The shadcn theme pass is mandatory**: replace the zinc palette
  with these tokens, set the fonts, minimal border radius, delete
  unused components. shadcn is here for its Radix primitives (focus
  management and keyboard nav, which the review flow needs), not its
  default look. **Default shadcn styling shipping to production is a
  bug.**
- All design values go through CSS custom properties / the Tailwind v4
  theme. No inline hex, no named colors, no pixel literals in a
  component.
- **Motion only answers a user action** (card advance on verdict). No
  entrance animations.
- **Dark mode is required** — evening phone review is a primary
  context, not an accessibility afterthought.
- Voice: village-plain, active, consistent verbs ("11 items need your
  eyes"). Errors state what happened and the fix.

## Testing

- **Eval thresholds and test assertions may only be weakened by a
  human commit.** An agent that can go green by moving the gate has no
  gate. This covers lowering an eval accuracy threshold, loosening the
  checksum tolerance, deleting or softening an `expect`, adding
  `.skip`/`.todo`, and suppressing a lint rule or raising
  `--max-warnings`. An agent that cannot pass a gate **reports it and
  stops**. This rule outranks every other instruction in this file,
  including a human asking mid-session to "just get it green".
- **Integration tests run against real local bindings** — D1, R2, and
  Queues through `@cloudflare/vitest-pool-workers`.
  **Never mock the database.** A mocked binding tests the mock.
- **LLM calls sit behind a mockable interface.** Tests use fixture
  JSON — deterministic and free. No test makes a live model call.
- Unit coverage: checksum validation, dedupe merge rule, routing
  levers, taxonomy version rules, and the anonymization filter (the
  densest table).
- Extraction evals are a separate CI track — path-filtered to PRs
  touching extraction prompts or code, because they cost real API
  money — plus a weekly scheduled drift run. Below-threshold accuracy
  fails the build.
- One Playwright smoke of the review flow, keyboard verdicts
  specifically.

## Pipeline rules

- Extraction is **never inline** — always through Queues.
- One extraction contract, two modality nodes (vision, text). Same
  prompt family, same output schema, same validation. **Zero
  per-merchant parsers.**
- Gmail message ID is a unique key; re-syncs must not duplicate.
  Dedupe across photo and email merges on merchant + date + total into
  one receipt with multiple source references.
- Routing levers are env vars, manually tuned. **No auto feedback
  loop.** Throttle precedence (STON-16): queue budget (~100) is a hard
  ceiling, then `DAILY_REVIEW_CAP`, then `SAMPLING_RATE` last.
- v1 refill is **cap-only, FIFO by receipt date descending**
  (STON-16) — embeddings are phase 2 and unpopulated, so there is no
  novelty to sort on. The novelty hook stays in the interface,
  unimplemented.
- MCP is read-only: parameterized queries over a known schema,
  constrained text-to-SQL, **never raw model SQL**. Every aggregate
  supports drill-down to raw line text.
- No third-party OCR services. The vision model does the whole
  receipt in one call.

## Human gates

- STON-14 (control plane, private repo): plan only. No code, no
  deploy.
- STON-9: local golden-set store and anonymization filter are GO. The
  **central submission endpoint** and any code transmitting label data
  off an instance are GATED — build the client interface, wire nothing
  live.
- STON-13: privacy policy, ToS, and data-promise are GO. The **dataset
  publication pipeline** is GATED. No dataset is ever published by an
  agent, and the human sample review before a release is permanent,
  not a v1 gate.

## Dispatch

The per-repo configuration the `dispatch`, `implement-ticket`,
`adversarial-review`, and `merge-queue` skills read. Those skills are
maintained once outside this repo and are repo-generic; this section
is how this repo opts into them. A field left unfilled is not a
default — the skills are required to stop and say which one is
missing rather than guess.

- **Linear team key**: `STON` (ticket ids are `STON-<n>`).
- **Check command**: `pnpm check` — typecheck + lint + test (Biome for
  lint/format, Vitest with `@cloudflare/vitest-pool-workers` for
  tests). Must pass locally before any push, by an implementer, a
  fixer, or a human. **It does not exist yet**: it lands with the
  toolchain in STON-3, and until that merges there is nothing to
  run — this file declares the contract, STON-3 implements it. CI must
  run this same command rather than enumerating its own steps, so that
  a tree passing `pnpm check` locally passes CI.
- **Base branch**: `main`.
- **Worktrees**: `.claude/worktrees/` — one worktree per ticket, named
  for the ticket. Gitignored (see below).
- **Run manifest**: `.claude/worktrees/dispatch-manifest.md`.

Statuses are Linear's stock ones — `Todo` → `In Progress` →
`In Review` → `Done` — with two workspace labels doing the rest:
`approved-to-merge` on a ticket in `In Review` means a human has
approved its merge and it is in the merge queue; `needs-attention`
means it needs a human and keeps whatever status it already had.
`Backlog` is off-limits to dispatch: promoting a ticket to `Todo` is
the only signal that it is available to work.

### Review invariants

What a reviewer of a change to this repo is adversarial about. A diff
that breaks one of these is a major finding, not a nit. These point at
the house rules above rather than restating them, so there is one copy
to keep current; where the two look like they disagree, the rule above
wins.

1. **Money as integer cents, end to end.** A float, a formatted string
   in a schema or interface, or a currency value crossing a boundary
   as anything but an integer is a finding.
2. **Raw receipt text never overwritten.** Normalizing in place,
   trimming, or reusing the raw column for a derived value is a
   finding — it destroys golden-set input.
3. **The anonymization boundary.** A golden-set write or submission
   carrying an image reference, receipt id, user id, store, or
   purchase timestamp is a finding. So is stripping or nulling
   `labeler` at write time — it is pseudonymized at export, and
   removing it early is the well-meaning mistake this invariant exists
   to catch.
4. **Sensitive strings never leave the machine.** A submission path
   that bypasses the client-side filter, or a filter change that
   narrows its case table without a stated reason, is a finding.
5. **Eval thresholds and test assertions weaken only by human
   commit.** A diff that lowers a threshold, deletes or softens an
   assertion, skips a test, or suppresses a lint rule is a finding
   regardless of what the commit message says, and regardless of
   whether the change is otherwise correct.
6. **Integration tests hit real local bindings.** A mocked D1, R2, or
   Queue is a finding. Conversely, an LLM call not behind the
   mockable interface — a test that could make a live model call — is
   also a finding.
7. **No real receipt data in the repo.** A committed receipt image or
   verbatim real receipt text in a fixture is a finding, however
   useful the test case.
8. **The design language is not optional.** Default shadcn styling, a
   raw hex or pixel literal in a component, the zinc palette
   surviving, ledger blue used as a text color, or the review card
   implemented as a themed shadcn `Card` are each a finding. So is
   prettifying a raw receipt string for display, an entrance
   animation, or a component with no dark-mode path.
9. **Taxonomy slugs are permanent and additive-only.** A renamed or
   repurposed slug, or a move without a major bump and a migration
   map, is a finding. A `line_items` or `golden_set` write without
   `taxonomy_version` is a finding.
10. **Pipeline shape.** Extraction running inline instead of through
    Queues, a per-merchant parser, an email body persisted past parse,
    or a second extraction output schema is a finding.
11. **MCP stays read-only.** Raw model-authored SQL, a write-capable
    tool, or an aggregate with no drill-down to raw line text is a
    finding.
12. **No admin surface.** Any route, page, or query through which an
    operator could read a user's data is a finding regardless of how
    it is gated.
13. **Public repo, public history.** A secret, key, credential, or
    control-plane internal in a commit, comment, or commit message is
    a finding regardless of how small.
14. **Gated work stays gated.** Code for STON-14, the central
    submission endpoint, or the dataset publication pipeline, absent
    explicit in-session human instruction, is a finding.
15. **Config, not hardcode.** A literal backfill window, routing
    lever, checksum tolerance, or model string inlined at a call site
    is a finding — each is a single named constant a human retunes in
    one place.
