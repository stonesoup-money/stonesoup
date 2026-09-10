# Privacy Policy

This policy covers the hosted Stone Soup service operated by [[LEGAL_ENTITY — a human must fill this in before this instance serves a hosted user — see docs/privacy-claims.md]] (contact: [[CONTACT_ADDRESS — a human must fill this in before this instance serves a hosted user — see docs/privacy-claims.md]]) at the domain where you are reading this. If you instead run your own copy of Stone Soup's open-source code on your own Cloudflare account, this policy does not apply to your deployment — see "If you self-host" below.

## What this app does

Stone Soup ingests your receipts — from photo upload and, once you connect it, Gmail — extracts the line items with a vision model, and categorizes them against a fixed spending taxonomy, so you can ask questions like "how much did I spend on alcohol this year?" that transaction-level finance apps cannot answer. It is a single-tenant application: this instance's database and storage hold only your data.

## What is stored in this instance

- **Receipt images**, in this instance's Cloudflare R2 bucket, at a path scoped to your account.
- **Receipt and line-item records** — merchant, date, amounts, and the individual line items extracted from each receipt — in this instance's D1 (SQLite) database. Money is stored as whole cents, never as a rounded or reformatted figure.
- **Your Gmail connection**, if you connect one: a sync checkpoint (a Gmail history ID) and connection status, scoped to your account, stored in this instance's database. OAuth tokens themselves — the credential that actually lets this instance read matching mail — are part of the same committed design but are not yet wired to a storage column in this schema *(design — not yet built; see docs/privacy-claims.md)*. Once implemented, they will be revocable at any time from your Google Account settings or by disconnecting inside the app.
- **A session cookie** that keeps you signed in to this instance. See "Cookies" below.
- **Compute is not billed to you and this instance does not ask you for a personal Anthropic key.** Receipt extraction runs on [[LEGAL_ENTITY — a human must fill this in before this instance serves a hosted user — see docs/privacy-claims.md]]'s own Anthropic API key, with your usage tracked against a monthly per-account extraction budget (see [/terms](/terms)). Your receipt images and extracted text are sent to Anthropic under [[LEGAL_ENTITY — a human must fill this in before this instance serves a hosted user — see docs/privacy-claims.md]]'s account to run that call — not under an account of your own.

None of the above leaves this instance except as described in "What leaves this instance" below.

## Google user data and Limited Use

If you connect Gmail, this app requests only the scope needed to read mail matching a sender-domain allowlist you control (receipt and order-confirmation senders you add) — not your full mailbox. Concretely:

- Only mail from allowlisted sender domains is fetched. The allowlist starts empty and grows only as you add senders; sync does not read your whole inbox looking for receipts.
- The first sync after you connect Gmail looks back 90 days (this instance's configured backfill window); after that, sync covers new mail incrementally, not a repeated full-mailbox scan.
- Once a matching message is parsed for its merchant, date, and line-item totals, **the email body is discarded entirely.** Nothing else about the message — names, addresses, other card numbers, unrelated content — is retained past that parse.
- Gmail data is used solely to extract receipt information for your own use inside this instance. It is never transferred to a third party except Anthropic, solely to run the extraction call itself, and never used for advertising, and never read by a human unless you explicitly share it.
- Disconnecting Gmail (in the app, or by revoking access in your Google Account) stops sync. Removing this instance's own stored OAuth tokens on disconnect is part of the same committed design *(design — not yet built; see docs/privacy-claims.md)* — see "Retention and deletion" below for what exists today.

This app's use and transfer of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

## Third parties

This instance sends data to a fixed, small set of outside services, and no others:

- **Anthropic** — receipt images and extracted text, to run the vision extraction call that reads your receipts. Governed by [[LEGAL_ENTITY — a human must fill this in before this instance serves a hosted user — see docs/privacy-claims.md]]'s own Anthropic API key, tracked per account against a monthly budget (see "What is stored in this instance" above and [/terms](/terms)).
- **Cloudflare** — this instance's own hosting, database (D1), file storage (R2), and background job queue. Cloudflare is the infrastructure this app runs on, not a separate data recipient.
- **Google** — solely for Gmail sync, if you connect it, per the section above.
- **Stone Soup's central submission service** — a golden-set label (see "What leaves this instance" below), if golden-set contribution is enabled. Unlike the three services above, this is not infrastructure you or this instance's operator control: it is infrastructure operated by the Stone Soup project itself, and for a self-hosted deployment it is the one recipient in this whole document that is not your own account. **This submission client does not exist in this codebase yet** *(design — not yet built; see docs/privacy-claims.md)* — until it is built, nothing reaches this recipient by any path.

There is no analytics vendor, no advertising or tracking pixel, and no third-party OCR or receipt-parsing service of any kind — extraction runs as one call to a vision model, nothing else touches your receipt data.

## What leaves this instance

The one thing this app is designed to send beyond your own instance is a **golden-set label**: when you review and confirm or correct a line item's category, a record of that decision may be submitted to Stone Soup's central submission service (see "Third parties" above), on its way to becoming part of Stone Soup's open, CC0-licensed labeled dataset (*Open Receipts*) — see [/data-promise](/data-promise) for exactly which fields are included, which are never included, and how to turn this off.

No receipt image, no receipt ID, no account ID, no merchant name, and no purchase date or timestamp is ever in a position to leave through that path, because none of those are ever written into a golden-set record in the first place — see [/data-promise](/data-promise). The one thing that *is* written into a golden-set record, and that does identify you within this instance, is `labeler`: an internal identifier kept locally for this instance's own quality control. It is replaced with a per-instance pseudonym before submission — nothing carrying the real `labeler` value ever crosses this instance's boundary. **This submission path does not exist in this codebase yet** *(design — not yet built; see docs/privacy-claims.md)* — until it is built, no golden-set label leaves this instance by any path.

## Retention and deletion

Your receipt images, records, and Gmail connection are retained for as long as your account exists on this instance, so the app can keep answering questions about your spending history.

**There is no account-deletion or per-receipt delete path in this application today, in either self-hosted or hosted mode**, and disconnecting a source does not yet remove its stored credentials either *(design — not yet built; see docs/privacy-claims.md)*. This instance's database is deliberately restrictive about deletion (every foreign key is `ON DELETE RESTRICT` — see `migrations/0001_initial_schema.sql`) precisely because the delete feature that would need it has not been built yet; building one that safely removes what it claims to remove is tracked as STON-18. Until it ships, the only way to stop this instance holding your data is for its operator to remove the underlying Cloudflare resources (this instance's D1 database and R2 bucket) directly.

A golden-set label already contributed under "What leaves this instance" above cannot be recalled after publication, for the same reason a published dataset in general cannot be edited after release — see [/data-promise](/data-promise).

## No operator access

There is no admin view or support screen, anywhere in this application, through which an operator — including [[LEGAL_ENTITY — a human must fill this in before this instance serves a hosted user — see docs/privacy-claims.md]] — can browse another user's receipts, line items, or images. Each deployment is single-tenant: your data lives in your own database and storage, structurally separate from every other user's, not merely access-controlled.

## Security

Data in transit to and from this instance is encrypted (HTTPS). Data at rest sits in Cloudflare's D1 and R2 services under this instance's own account. Your Anthropic key, in a self-hosted or BYOK deployment, is stored as a Workers Secret, a mechanism designed so the running application can use it without it appearing in logs, database rows, or the deployed source.

## Cookies

This instance sets one cookie: a signed session token that keeps you signed in. There is no tracking cookie, no third-party cookie, and no advertising cookie.

**Contact.** Questions about this policy, or to exercise a data-protection right, contact [[LEGAL_ENTITY — a human must fill this in before this instance serves a hosted user — see docs/privacy-claims.md]] at [[CONTACT_ADDRESS — a human must fill this in before this instance serves a hosted user — see docs/privacy-claims.md]].

**Governing law.** This policy is governed by the laws of [[GOVERNING_JURISDICTION — a human must fill this in before this instance serves a hosted user — see docs/privacy-claims.md]].

**Effective date.** This policy takes effect on [[EFFECTIVE_DATE — a human must fill this in before this instance serves a hosted user — see docs/privacy-claims.md]]. It was last revised on 2026-09-10.

## If you self-host instead

Stone Soup is AGPL-3.0 open-source software. If you deploy your own copy to your own Cloudflare account instead of using this hosted service, you are the operator of that instance: your data goes to your D1 database, your R2 bucket, and your Gmail OAuth app, under your own Google Cloud project. This policy does not apply to your deployment — the same document, rendered by your instance with `DEPLOYMENT_MODE` left at its default `"self-hosted"`, applies instead and says so plainly.
