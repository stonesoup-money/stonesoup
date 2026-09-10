# Privacy policy claims — evidence table

This table exists so a reviewer (human or agent) can judge the privacy
policy, ToS, and data promise on accuracy, not plausibility (STON-13
plan, "Accuracy: how a reviewer knows it is true, not plausible"). One
row per normative claim in `/privacy`, `/terms`, or `/data-promise` →
evidence, or `NOT YET IMPLEMENTED — STON-n` where the policy describes
committed design for a capability that has not shipped yet.

**Any ticket that changes what data is collected, retained, or
transmitted must update this table and the corresponding document in the
same PR** (AGENTS.md, "Public pages and the privacy policy"). A behaviour
change that outruns this table is a review-invariant violation (AGENTS.md
invariant #24).

## Human checkbox

- [ ] **A human has re-walked every row below**, confirming each is still
      accurate, before: (a) the hosted service accepts its first real
      user, and (b) Google OAuth verification is submitted. Any row still
      marked `NOT YET IMPLEMENTED` at that point is a launch blocker, not
      a note. Sign-off: <!-- name, date -->.

## Claims

| # | Claim (document) | Status | Evidence |
|---|---|---|---|
| 1 | The app is single-tenant; this instance's D1/R2 hold only your data. (privacy) | Implemented | `wrangler.jsonc` — one `DB` (D1) and `RECEIPTS` (R2) binding per deployed Worker; `migrations/0001_initial_schema.sql` has no cross-tenant table. |
| 2 | Money is stored as whole cents, never reformatted. (privacy) | Implemented | `migrations/0001_initial_schema.sql` — every money column is `*_cents INTEGER` with a `typeof(...) = 'integer'` CHECK; `packages/core/src/money.ts`. |
| 3 | The Anthropic key is stored as a Workers Secret, never in D1, never logged. (privacy) | Implemented (storage) / policy commitment (logging) | `packages/worker/src/env.d.ts` (secret-only binding, no `wrangler.jsonc` `vars` entry); `.dev.vars.example`. "Never logged" is enforced by code review (AGENTS.md, BYOK bullet), not a runtime check — no code path logs it today because no such code exists yet. |
| 4 | Only sender-domain-allowlisted Gmail is fetched. (privacy) | NOT YET IMPLEMENTED — STON-6 | Gmail sync (cron trigger) is unimplemented; `packages/worker/src/index.ts`'s `scheduled()` is a stub. Committed design: AGENTS.md, Pipeline rules, "Gmail sync only fetches sender-domain-allowlisted mail." |
| 5 | The initial Gmail backfill window is 90 days. (privacy) | Implemented (config) / NOT YET IMPLEMENTED (sync itself) | `packages/core/src/config.ts` `BACKFILL_WINDOW_DAYS = 90`; `wrangler.jsonc` `vars.BACKFILL_WINDOW_DAYS`; cross-checked against the rendered policy text in `packages/worker/src/public/policy-claims.test.ts`. The number is real config; the sync that would honor it is STON-6. |
| 6 | Email bodies are discarded entirely after parse. (privacy) | NOT YET IMPLEMENTED — STON-6 | No email-parsing code exists yet. Committed design: AGENTS.md, Privacy section, "Email bodies are discarded entirely after parse." |
| 7 | Gmail data is never transferred to a third party except Anthropic, never used for ads, never human-read without consent. (privacy) | Design commitment | No code path exists yet that could violate this (no Gmail integration). Enforced going forward by AGENTS.md review invariants #3, #4, #12 and this table's re-walk requirement. |
| 8 | Third parties are exactly Anthropic, Cloudflare, and Google — no analytics, no ad tech, no third-party OCR. (privacy) | Implemented | `packages/worker/package.json` dependencies (`@anthropic-ai/sdk`, `hono`) — no analytics/ad SDK anywhere in the repo; `wrangler.jsonc` bindings are all first-party Cloudflare services. |
| 9 | Golden-set records carry no receipt id, user id, store, or purchase timestamp, and no image reference. (data-promise) | Implemented | `migrations/0001_initial_schema.sql`, `golden_set` table definition — no such columns exist. Machine-checked: `packages/worker/src/public/policy-claims.test.ts`, `PRAGMA table_info(golden_set)` assertion (the one read-only exception the STON-13 gate allows). |
| 10 | `labeler` is written and kept, pseudonymized only at export, never nulled at write. (data-promise) | Implemented (schema) / NOT YET IMPLEMENTED (export pipeline) | `migrations/0001_initial_schema.sql` — `golden_set.labeler TEXT NOT NULL`, machine-checked in `policy-claims.test.ts`. The export/pseudonymization step itself is the gated dataset publication pipeline — see `docs/dataset-publication.md`; it does not exist in this repository by design. |
| 11 | Golden-set contribution defaults to "on" in both self-hosted and hosted deployments. (terms, data-promise) | Implemented (default) / NOT YET IMPLEMENTED (submission path) | `packages/core/src/config.ts` `GOLDEN_SET_CONTRIBUTION_DEFAULT = "on"`; `wrangler.jsonc` `vars.GOLDEN_SET_CONTRIBUTION`; cross-checked in `policy-claims.test.ts`. The review-verdict → golden_set write path and the central submission endpoint are STON-9 (endpoint itself is human-gated). |
| 12 | The client-side sensitive-string filter runs before any submission leaves the device. (data-promise) | NOT YET IMPLEMENTED — STON-9 | The filter is planned as a local, client-side check (STON-9's GO scope); it does not exist in this repository yet. |
| 13 | There is no admin view anywhere; no operator can read a user's data. (privacy) | Implemented (by absence) | No admin route exists anywhere in `packages/worker/src` — grep-verifiable. Structural, not access-controlled: per-tenant isolation (one D1/R2 pair per deployment) makes a cross-tenant admin view architecturally impossible to add without a schema change. Guarded going forward by AGENTS.md review invariant #12. |
| 14 | One session cookie, no tracking. (privacy) | NOT YET IMPLEMENTED — STON-4 | Auth/session is unimplemented. Committed design: AGENTS.md, Auth section, "hand-rolled, signed JWT in a cookie." |
| 15 | Disconnecting Gmail removes stored OAuth tokens; deletion removes receipts/images/line items. (privacy) | NOT YET IMPLEMENTED — STON-4 / STON-6 | No account-deletion or disconnect flow exists yet. |
| 16 | Hosted-mode contact, legal entity, and jurisdiction are stated, not fabricated. (privacy, terms) | Placeholder, by design | `packages/core/src/legal/context.ts` — `DEFAULT_OPERATOR_NAME`, `DEFAULT_OPERATOR_CONTACT`, `PLACEHOLDER_JURISDICTION`, `PLACEHOLDER_EFFECTIVE_DATE`, `PLACEHOLDER_HOSTED_DELETION_MECHANISM` all render as an unmissable `[[...]]` marker until a human sets `OPERATOR_NAME` / `OPERATOR_CONTACT` (`wrangler.jsonc` vars) and edits the jurisdiction/effective-date/deletion-mechanism placeholders directly. A self-hosted deployment never reads any of these — see row 17. |
| 17 | A self-hosted instance needs no legal entity and no jurisdiction, and says so. (privacy, terms) | Implemented | `packages/core/src/legal/documents.test.ts` — "self-hosted mode renders with no unfilled-fact placeholder" (asserts no `[[` marker appears when `DEFAULT_LEGAL_CONTEXT.mode === "self-hosted"`). |
| 18 | `/privacy`, `/terms`, `/data-promise` return 200 with no credentials required, real content, no SPA shell. | Implemented | `packages/worker/src/public/pages.test.ts` (`SELF.fetch`, no auth header, asserts 200 + real body); `scripts/verify-public-routes.mjs` (static `run_worker_first` cross-check, wired into `pnpm check`). |
| 19 | Open Receipts is released under CC0 with a citation request, stated before any label is collected. (data-promise) | Implemented (statement) / by construction (no labels collected yet) | `packages/core/src/legal/data-promise.ts` — the CC0 + citation section. No golden-set write path exists yet (STON-9), so no label has been collected under any other terms. |
| 20 | Publication requires a permanent human sample review before every tagged release. (data-promise) | Statement only — the pipeline itself is gated | See `docs/dataset-publication.md`. No release script exists in this repository; this row records the promise, not a mechanism this repo enforces (the mechanism is a human process in the separate `open-receipts` repo). |

## Notes on the "NOT YET IMPLEMENTED" rows

Writing a narrower privacy policy that simply omits Gmail, or golden-set
contribution, was considered and rejected (STON-13 plan): the Gmail
consent-screen requirement is the entire reason this page exists, and a
policy that doesn't mention Gmail cannot serve as the consent-screen URL
Google actually wants. The policy therefore describes the **committed
design** for capabilities that must exist before any user data can be
collected under them, and this table is what keeps that honest — every
row above either points at real, checkable evidence, or says plainly that
it doesn't yet.
