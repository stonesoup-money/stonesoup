# Stone Soup

A traveller arrives in a hungry village with nothing but a stone, and sets
it boiling. One neighbour brings a carrot, another an onion, a third a
handful of barley. Nobody had a meal; everybody eats.

Stone Soup answers line-item-level spending questions that transaction-level
tools can't — "how much on vegetables versus alcohol?" — by reading your
receipts instead of your bank feed. It's self-hostable, AGPL-3.0, and it runs
on your own Anthropic API key. The stone is the taxonomy and the code; the
carrots are the handful of receipt lines each person corrects, which become a
public dataset everyone can use.

## Status: pre-alpha. Do not put this on a public URL yet.

**There is no authentication.** Every request is handed the same fixed
placeholder user, and the upload and review endpoints have no session
middleware in front of them. A publicly reachable deployment of this tree is
an open image-upload endpoint that spends your Anthropic key for anyone who
finds the URL, plus an open read endpoint over whatever receipts it holds.

Auth is the next major piece of work. Until it lands, run this locally
(`pnpm dev`), or put Cloudflare Access in front of it.

## What works today

The photo path runs end to end:

1. You upload a receipt photo. It lands in R2 under
   `{userId}/{yyyy}/{mm}/{receiptUuid}`, and a row is written to D1.
2. A queue message is enqueued. Extraction is never inline.
3. The queue consumer sends the whole receipt to an Anthropic vision model
   in one call — no OCR service, no per-merchant parsers — and gets back
   structured JSON: merchant, date, totals, and line items.
4. The result is checksum-validated: the line items plus tax have to add up
   to the stated total, within a tolerance. A receipt that fails goes to
   review as a whole.
5. Low-confidence lines land in a review queue.
6. You give each line a verdict from the keyboard. That writes a
   `golden_set` record immediately, in the same transaction — never a
   later batch job.

Also built: the receipt dedupe rule (a photo and an email of the same
purchase merge on merchant + date + total), an ordered delete primitive, your
API key's format and model validated on a settings poll, and the public
`/privacy`, `/terms` and `/data-promise` pages, server-rendered with no JS.

## What isn't built yet

Auth (Google OAuth + JWT sessions), Gmail sync, the MCP server you'd query
from Claude, the full review inbox and "This Month" page, the eval harness,
and golden-set submission. The taxonomy ships provisional at version `0.1.0`
and is waiting on a human pass over real receipt lines.

Some of these are named in the code as stubs — the cron handler is empty, the
session helper returns a placeholder — so that the shape is visible before
the implementation lands.

## Running it locally

Requires Node and pnpm, plus an Anthropic API key for extraction.

```bash
pnpm install
cp .dev.vars.example .dev.vars   # then put your key in it
pnpm dev
```

`pnpm dev:lan` binds to your local network instead of localhost, so you can
reach it from a phone on the same Wi-Fi — which is how you'd photograph an
actual receipt without deploying anything.

Before pushing anything, `pnpm check` runs the whole gate: typecheck, lint,
tests, and six verifier scripts.

## Deploying it yourself

Read the status warning above first.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/stonesoup-money/stonesoup)

The button provisions D1, R2 and Queues from `wrangler.jsonc`, prompts for
your own `ANTHROPIC_API_KEY`, and runs the migration before deploying. The
key is stored as a Workers Secret in your own account — it is never sent
anywhere but Anthropic, and this project's maintainers never see it.

A full self-hosting walkthrough, including the Google Cloud console steps, is
still to be written; it needs auth to exist first.

## The deal

Your receipts, images, and extracted line items stay in your own Cloudflare
account. Nothing about a purchase leaves your instance.

What can leave, if you leave contribution on, is label data: the raw printed
line, what the model guessed, what you corrected it to, and the taxonomy
version. No image, no receipt id, no user id, no store, no purchase
timestamp — those are never written to the record in the first place. A
client-side filter runs before anything is submitted, so pharmacy-pattern
items and name-like strings never leave your machine.

That collected dataset is published as Open Receipts under CC0, with a
citation request. This is the point of the project: receipt-line
categorization has no good public dataset, and one built out of corrections
people were making anyway is worth more than another proprietary model.

The submission endpoint is not live yet. Read
[`/data-promise`](docs/data-promise.md) for the full version, including the
uncomfortable detail that a printed receipt line often contains its own
price.

## More

- [ARCHITECTURE.md](ARCHITECTURE.md) — how the pieces fit, and where the
  open/closed boundary is
- [CONTRIBUTING.md](CONTRIBUTING.md) — contributing code, or labels
- [AGENTS.md](AGENTS.md) — the standing rules this repo is built under
- [docs/privacy.md](docs/privacy.md), [docs/terms.md](docs/terms.md),
  [docs/data-promise.md](docs/data-promise.md)

## License

AGPL-3.0. If you run a modified version as a network service, you owe your
users the source.
