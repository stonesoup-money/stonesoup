# Privacy Policy

This policy covers the hosted Stone Soup service operated by [[LEGAL_ENTITY — a human must fill this in before this instance serves a hosted user — see docs/privacy-claims.md]] (contact: [[CONTACT_ADDRESS — a human must fill this in before this instance serves a hosted user — see docs/privacy-claims.md]]) at the domain where you are reading this. If you instead run your own copy of Stone Soup's open-source code on your own Cloudflare account, this policy does not apply to your deployment — see "If you self-host" below.

## The status of this document

Stone Soup is under construction, and this policy describes a design that is only partly built. **This codebase now collects, stores, and transmits real receipt data through the photo-upload path**: a photo you upload is stored in this instance's R2 bucket, sent to Anthropic for a vision-extraction call, and its line items are written to this instance's D1 database; when you review a line item, a local `golden_set` record is written on this instance too. It still has no sign-in and no Gmail sync, and it still transmits nothing to Stone Soup's own central submission service — no golden-set label has ever left this instance. Wherever a sentence below describes behaviour that does not exist yet, it carries the marker *(design — not yet built; see docs/privacy-claims.md)* at the point of the claim.

`docs/privacy-claims.md`, in the same public repository as the code, is the row-by-row status of every claim on this page: which are backed by shipped code or schema, and which are not backed by anything yet.

## What this app does

Stone Soup ingests your receipts — from photo upload and, once you connect it, Gmail — extracts the line items with a vision model, and categorizes them against a fixed spending taxonomy, so you can ask questions like "how much did I spend on alcohol this year?" that transaction-level finance apps cannot answer. **The photo-upload half of that pipeline is built**: uploading a photo stores it, runs one vision-extraction call, and categorizes each line item against the taxonomy. **Gmail sync is not built yet** *(design — not yet built; see docs/privacy-claims.md)*. It is a single-tenant application: this instance's database and storage hold only your data.

## What is stored in this instance

- **Receipt images**, in this instance's Cloudflare R2 bucket, at a path scoped to your account. Uploading a photo stores it here today.
- **Receipt and line-item records** — merchant, date, amounts, and the individual line items extracted from each receipt — in this instance's D1 (SQLite) database. Uploading and extracting a photo writes these rows today. Money is recorded as whole cents, never as a rounded or reformatted figure — that one is a schema constraint, not a convention.
- **Your Gmail connection**, if you connect one: a sync checkpoint (a Gmail history ID) and connection status, scoped to your account, stored in this instance's database. Those columns are real in this schema; the sync that would fill them is not built *(design — not yet built; see docs/privacy-claims.md)*. OAuth tokens themselves — the credential that actually lets this instance read matching mail — are part of the same committed design but are not yet wired to a storage column in this schema *(design — not yet built; see docs/privacy-claims.md)*. Once implemented, they will be revocable at any time from your Google Account settings or by disconnecting inside the app.
- **A session cookie** that would keep you signed in to this instance *(design — not yet built; see docs/privacy-claims.md)*. There is no sign-in in this codebase yet and this instance sets no cookie at all today — see "Cookies" below.
- **Compute is not billed to you, and this instance does not ask you for a personal Anthropic key.** Receipt extraction runs on [[LEGAL_ENTITY — a human must fill this in before this instance serves a hosted user — see docs/privacy-claims.md]]'s own Anthropic API key: this call is built, and uploading a photo sends your receipt image and extracted text to Anthropic under [[LEGAL_ENTITY — a human must fill this in before this instance serves a hosted user — see docs/privacy-claims.md]]'s account to run it — not under an account of your own. Your usage is intended to be metered against a monthly per-account extraction budget (see [/terms](/terms)) *(design — not yet built; see docs/privacy-claims.md)*: that budget and its metering do not exist in this codebase yet, so today every hosted account's extraction runs with nothing billed to it and no cap on it.

The one exception among the items above: a receipt image and its extracted text leave this instance for exactly one purpose today, the vision-extraction call to Anthropic described in "Third parties" below. Nothing else above leaves this instance except as described in "What leaves this instance" further down (the golden-set label path).

## Google user data and Limited Use

If you connect Gmail, this app is designed to request Google's `gmail.readonly` scope *(design — not yet built; see docs/privacy-claims.md)* — no Gmail integration exists in this codebase yet. Two things about that scope are true at once, and this policy states them separately rather than blurring them into a single reassuring sentence:

- **What the grant itself permits.** `gmail.readonly` is the narrowest Google scope that can read message content, and it permits reading **any** mail in the account. Google does not know about, and does not enforce, the sender-domain allowlist described below.
- **What this app's own code does with it.** This app's queries are restricted to a sender-domain allowlist you control — receipt and order-confirmation senders you add *(design — not yet built; see docs/privacy-claims.md)*. That restriction is enforced by this application's code, which you can read because it is AGPL-3.0 open source, **not** by the grant. If this app were changed or compromised, the grant alone would not stop it reading other mail; revoking access in your Google Account would.

Concretely, on the design as committed *(design — not yet built; see docs/privacy-claims.md)*:

- Only mail from allowlisted sender domains is fetched. The allowlist starts empty and grows only as you add senders; sync does not read your whole inbox looking for receipts.
- The first sync after you connect Gmail looks back 90 days (this instance's configured backfill window); after that, sync covers new mail incrementally, not a repeated full-mailbox scan.
- Once a matching message is parsed for its merchant, date, and line-item totals, **the email body is discarded entirely.** Nothing else about the message — names, addresses, other card numbers, unrelated content — is retained past that parse.
- Gmail data is used solely to extract receipt information for your own use inside this instance. It is never transferred to a third party except Anthropic, solely to run the extraction call itself, and never used for advertising, and never read by a human unless you explicitly share it.
- Disconnecting Gmail (in the app, or by revoking access in your Google Account) stops sync. Removing this instance's own stored OAuth tokens on disconnect is part of the same committed design — see "Retention and deletion" below for what exists today.

This app's use and transfer of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

## Third parties

This instance is designed to send data to a fixed, small set of outside services, and no others. Today this instance makes two kinds of outbound request: a routine Anthropic-key-validity check (`GET /api/byok/status`, which sends no receipt, message, or label data), and — when you upload a receipt photo — exactly one vision-extraction call per receipt, sending that image and its extracted text to Anthropic. Neither Gmail sync nor a golden-set submission makes any outbound request yet *(design — not yet built; see docs/privacy-claims.md)*:

- **Anthropic** — receipt images and extracted text, to run the vision extraction call that reads your receipts. This call is built: uploading a photo triggers exactly one of these per receipt. Governed by [[LEGAL_ENTITY — a human must fill this in before this instance serves a hosted user — see docs/privacy-claims.md]]'s own Anthropic API key, metered per account against a monthly budget (see "What is stored in this instance" above and [/terms](/terms)).
- **Cloudflare** — this instance's own hosting, database (D1), file storage (R2), and background job queue. Cloudflare is the infrastructure this app runs on, not a separate data recipient. This one is real today: this page is served by a Cloudflare Worker.
- **Google** — solely for Gmail sync, if you connect it, per the section above.
- **Stone Soup's central submission service** — a golden-set label (see "What leaves this instance" below), if golden-set contribution is enabled. Unlike the three services above, this is not infrastructure you or this instance's operator control: it is infrastructure operated by the Stone Soup project itself, and for a self-hosted deployment it is the one recipient in this whole document that is not your own account. **This submission client does not exist in this codebase yet** — until it is built, nothing reaches this recipient by any path.

There is no analytics vendor, no advertising or tracking pixel, and no third-party OCR or receipt-parsing service of any kind. Extraction is one call to a vision model, with nothing else touching your receipt data.

## What leaves this instance

The one thing this app is designed to send beyond your own instance is a **golden-set label**: when you review and confirm or correct a line item's category, a record of that decision may be submitted to Stone Soup's central submission service (see "Third parties" above), on its way to becoming part of Stone Soup's open, CC0-licensed labeled dataset (*Open Receipts*) *(design — not yet built; see docs/privacy-claims.md)* — see [/data-promise](/data-promise) for exactly which fields are included, which are never included, and why, on this hosted service, contribution is the free tier's payment rather than a setting you can switch off.

No receipt image, no receipt ID, no account ID, no merchant name, and no purchase date or timestamp is ever in a position to leave through that path, because none of those are ever written into a golden-set record in the first place — see [/data-promise](/data-promise). The one thing that *is* written into a golden-set record, and that does identify you within this instance, is `labeler`: an internal identifier kept locally for this instance's own quality control. It is replaced with a per-instance pseudonym before submission — nothing carrying the real `labeler` value ever crosses this instance's boundary. **This submission path does not exist in this codebase yet** *(design — not yet built; see docs/privacy-claims.md)* — until it is built, no golden-set label leaves this instance by any path.

## Retention and deletion

Your receipt images, records, and Gmail connection are designed to be retained for as long as your account exists on this instance, so the app can keep answering questions about your spending history *(design — not yet built; see docs/privacy-claims.md)* — there are no accounts in this codebase yet, so "for as long as your account exists" has no meaning today. Receipt images and records themselves are stored today (see "What is stored in this instance" above); there is simply no account-scoped retention policy governing them yet.

**There is no account-deletion or per-receipt delete path in this application today, in either self-hosted or hosted mode**, and disconnecting a source does not yet remove its stored credentials either *(design — not yet built; see docs/privacy-claims.md)*. This instance's database is deliberately restrictive about deletion (every foreign key is `ON DELETE RESTRICT` — see `migrations/0001_initial_schema.sql`), so that a delete feature could be built safely later instead of by a schema migration. That safe, ordered delete now exists as tested code in this repository (`packages/worker/src/receipts/delete.ts`), but nothing in the product calls it yet — there is no route and no screen that reaches it, so this remains true today: you cannot delete a receipt or your account from this app. Wiring it to an authenticated route with an ownership check is tracked as STON-24, separate from the primitive itself. Until that ships, the only way to stop this instance holding your data is for its operator to remove the underlying Cloudflare resources (this instance's D1 database and R2 bucket) directly.

When a per-receipt delete is wired up, it will not remove anonymized golden-set labels already derived from that receipt: a `golden_set` record carries nothing that links it back to a receipt — no receipt ID, no user ID, no purchase timestamp (see [/data-promise](/data-promise)) — so there is no query that could find "the labels from this receipt" to remove them, by design, not by omission.

A golden-set label already contributed under "What leaves this instance" above could not be recalled after publication, for the same reason a published dataset in general cannot be edited after release — see [/data-promise](/data-promise). No label has been contributed, because the path does not exist; this is what the promise will mean once it does.

## No operator access

There is no admin view or support screen, anywhere in this application, through which an operator — including [[LEGAL_ENTITY — a human must fill this in before this instance serves a hosted user — see docs/privacy-claims.md]] — can browse another user's receipts, line items, or images. Each deployment is single-tenant. Your database — receipts, line items, everything extracted — is a physically separate database no other user's instance can reach. Receipt images live in shared storage partitioned per user and enforced in code.

## Security

Data in transit to and from this instance is encrypted (HTTPS). Data at rest sits in Cloudflare's D1 and R2 services under this instance's own account. This service's own Anthropic API key — not one you provide — is stored as a Workers Secret in the operator's deployment, a mechanism designed so the running application can use it without it appearing in logs, database rows, or the deployed source.

## Cookies

This instance is designed to set exactly one cookie: a signed session token that keeps you signed in *(design — not yet built; see docs/privacy-claims.md)*. **Sign-in does not exist in this codebase yet, so this instance sets no cookie at all today** — an uncredentialed request for this page comes back with no `Set-Cookie` header, which the public-pages test suite asserts on every response. There is no tracking cookie, no third-party cookie, and no advertising cookie, and none is planned.

**Contact.** Questions about this policy, or to exercise a data-protection right, contact [[LEGAL_ENTITY — a human must fill this in before this instance serves a hosted user — see docs/privacy-claims.md]] at [[CONTACT_ADDRESS — a human must fill this in before this instance serves a hosted user — see docs/privacy-claims.md]].

**Governing law.** This policy is governed by the laws of [[GOVERNING_JURISDICTION — a human must fill this in before this instance serves a hosted user — see docs/privacy-claims.md]].

**Effective date.** This policy takes effect on [[EFFECTIVE_DATE — a human must fill this in before this instance serves a hosted user — see docs/privacy-claims.md]]. It was last revised on 2026-09-10.

## If you self-host instead

Stone Soup is AGPL-3.0 open-source software. If you deploy your own copy to your own Cloudflare account instead of using this hosted service, you are the operator of that instance: it runs against your D1 database and your R2 bucket, and would use your own Gmail OAuth app under your own Google Cloud project *(design — not yet built; see docs/privacy-claims.md)*. This policy does not apply to your deployment — the same document, rendered by your instance with `DEPLOYMENT_MODE` left at its default `"self-hosted"`, applies instead and says so plainly.
