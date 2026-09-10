# Privacy Policy

This is a self-hosted instance of Stone Soup. There is no separate operator: whoever deployed this instance controls it, and your data goes to their Cloudflare account, not to Stone Soup the project or its maintainers. This document describes what the software does with your data on **any** instance; the "who to contact" details below are the deployer's, not ours.

## What this app does

Stone Soup ingests your receipts — from photo upload and, once you connect it, Gmail — extracts the line items with a vision model, and categorizes them against a fixed spending taxonomy, so you can ask questions like "how much did I spend on alcohol this year?" that transaction-level finance apps cannot answer. It is a single-tenant application: this instance's database and storage hold only your data.

## What is stored in this instance

- **Receipt images**, in this instance's Cloudflare R2 bucket, at a path scoped to your account.
- **Receipt and line-item records** — merchant, date, amounts, and the individual line items extracted from each receipt — in this instance's D1 (SQLite) database. Money is stored as whole cents, never as a rounded or reformatted figure.
- **Your Gmail connection**, if you connect one: OAuth tokens that let this instance read matching mail, and a sync checkpoint (a Gmail history ID), scoped to your account and revocable at any time from your Google Account settings or by disconnecting inside the app.
- **A session cookie** that keeps you signed in to this instance. See "Cookies" below.
- **Your Anthropic API key**, if you provide one for receipt extraction, stored as a Cloudflare Workers Secret — a mechanism separate from this instance's database, never written to D1, never logged, and never sent anywhere except to Anthropic's API to run your own extraction requests.

None of the above leaves this instance except as described in "What leaves this instance" below.

## Google user data and Limited Use

If you connect Gmail, this app requests only the scope needed to read mail matching a sender-domain allowlist you control (receipt and order-confirmation senders you add) — not your full mailbox. Concretely:

- Only mail from allowlisted sender domains is fetched. The allowlist starts empty and grows only as you add senders; sync does not read your whole inbox looking for receipts.
- The first sync after you connect Gmail looks back 90 days (this instance's configured backfill window); after that, sync covers new mail incrementally, not a repeated full-mailbox scan.
- Once a matching message is parsed for its merchant, date, and line-item totals, **the email body is discarded entirely.** Nothing else about the message — names, addresses, other card numbers, unrelated content — is retained past that parse.
- Gmail data is used solely to extract receipt information for your own use inside this instance. It is never transferred to a third party except Anthropic, solely to run the extraction call itself, and never used for advertising, and never read by a human unless you explicitly share it.
- Disconnecting Gmail (in the app, or by revoking access in your Google Account) stops sync and removes the stored OAuth tokens from this instance.

This app's use and transfer of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

## Third parties

This instance sends data to exactly three outside services, and no others:

- **Anthropic** — receipt images and extracted text, to run the vision extraction call that reads your receipts. Governed by whichever API key is configured for this instance (your own, in a self-hosted or BYOK deployment).
- **Cloudflare** — this instance's own hosting, database (D1), file storage (R2), and background job queue. Cloudflare is the infrastructure this app runs on, not a separate data recipient.
- **Google** — solely for Gmail sync, if you connect it, per the section above.

There is no analytics vendor, no advertising or tracking pixel, and no third-party OCR or receipt-parsing service of any kind — extraction runs as one call to a vision model, nothing else touches your receipt data.

## What leaves this instance

The one thing this app is designed to send beyond your own instance is a **golden-set label**: when you review and confirm or correct a line item's category, an anonymized record of that decision may be contributed to Stone Soup's open, CC0-licensed labeled dataset (*Open Receipts*) — see [/data-promise](/data-promise) for exactly which fields are included, which are never included, and how to turn this off. No receipt image, no account identifier, no merchant name, and no purchase date ever leaves this instance through that path.

## Retention and deletion

Your receipt images, records, and Gmail connection are retained for as long as your account exists on this instance, so the app can keep answering questions about your spending history. Disconnecting a source removes its stored credentials immediately; deleting your account (where this instance's deployer has implemented account deletion) removes your receipts, images, and line items from this instance's database and storage. A golden-set label already contributed under "What leaves this instance" above cannot be recalled after publication, for the same reason a published dataset in general cannot be edited after release — see [/data-promise](/data-promise).

## No operator access

There is no admin view or support screen, anywhere in this application, through which an operator — including a self-hosting deployer — can browse another user's receipts, line items, or images. Each deployment is single-tenant: your data lives in your own database and storage, structurally separate from every other user's, not merely access-controlled.

## Security

Data in transit to and from this instance is encrypted (HTTPS). Data at rest sits in Cloudflare's D1 and R2 services under this instance's own account. Your Anthropic key is stored as a Workers Secret, a mechanism designed so the running application can use it without it appearing in logs, database rows, or the deployed source.

## Cookies

This instance sets one cookie: a signed session token that keeps you signed in. There is no tracking cookie, no third-party cookie, and no advertising cookie.

**Contact and governing law.** A self-hosted instance has no separate legal entity and no jurisdiction of its own — you are the operator, running the code on infrastructure you control. If you offer this instance to other people, you should add your own contact details and, if relevant to you, a governing jurisdiction, here. This document was last revised on 2026-09-10.

## If you offer this instance to other people

This document currently renders as a self-hosted policy: no separate legal entity, no jurisdiction, because none exists by default. If you are deploying this instance for people other than yourself, set the `DEPLOYMENT_MODE`, `OPERATOR_NAME`, and `OPERATOR_CONTACT` Worker variables in your `wrangler.jsonc` to describe your own operating entity, and review the hosted-mode placeholders in `docs/privacy-claims.md` before you do — they exist so an incomplete hosted policy is visibly incomplete, not plausible-looking.
