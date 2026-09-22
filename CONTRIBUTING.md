# Contributing

There are two ways to contribute to Stone Soup, and the second one matters
more.

## Contributing labels

The reason this project exists is that receipt-line categorization has no
good public dataset. Every time you correct a category in the review inbox,
you produce one labelled example: the raw printed line, what the model
guessed, what it actually was, and the taxonomy version. Collected across
people, that becomes Open Receipts — published under CC0, with a citation
request.

You don't have to write any code to contribute this. Running an instance and
reviewing your own receipts is the contribution.

**This isn't live yet.** The local golden-set store is built; the submission
endpoint is not. Nothing leaves any instance today. When it does ship, it
will be opt-out, disclosed before any label is collected, and filtered
client-side before anything is sent. See
[`docs/data-promise.md`](docs/data-promise.md) for exactly which fields
travel and which never do.

## Contributing code

```bash
pnpm install
cp .dev.vars.example .dev.vars   # add your own Anthropic key
pnpm dev                         # or pnpm dev:lan to reach it from a phone
```

Before you push anything:

```bash
pnpm check
```

That runs typecheck, lint, the full test suite, and six verifier scripts. CI
runs the same command, so a tree that passes locally passes CI. It is not
optional, and it is not something to work around.

### Read AGENTS.md first

[AGENTS.md](AGENTS.md) is the standing brief for this repository — the house
rules, the data conventions, the privacy boundary, the design language, and
the list of things a reviewer will be adversarial about. It's written for
both humans and coding agents. Most review comments you'd otherwise receive
are already answered there.

A few rules that trip people up:

**Money is integer cents everywhere.** Never a float, never a preformatted
string in a schema or across an interface. Format at the render edge only.

**Never overwrite raw receipt text.** `raw`, `normalized`, and `category` are
three separate fields. The raw string is the dataset's input. Trimming or
title-casing it for display is also a bug — it's evidence, not copy.

**Never write `INSERT OR REPLACE` or `REPLACE INTO`.** Anywhere, on any
table. Use `ON CONFLICT (...) DO UPDATE`. A verifier script enforces this.

**No real receipts in the repository.** No images, no verbatim real receipt
text in fixtures, however useful the test case. Fixtures are synthetic.

**Don't weaken a gate to get green.** Lowering an eval threshold, loosening
the checksum tolerance, deleting or softening an assertion, adding `.skip` or
`.todo`, suppressing a lint rule — all of these need a human commit with a
stated reason. If you can't pass a gate, say so in the PR and stop. This rule
outranks everything else in AGENTS.md.

**Tests hit real local bindings.** D1, R2, and Queues run for real through
`@cloudflare/vitest-plugin`. Don't mock the database; a mocked binding tests
the mock. Don't make a live model call from a test either — extraction sits
behind a mockable interface with fixture JSON.

### Design work

The visual language is deliberate and it isn't generic warm-startup styling —
it's the paper ledger and thermal receipt paper. Palette, type, and structure
are set out in AGENTS.md. All values go through CSS custom properties in
`packages/web/public/tokens.css`; no inline hex, no pixel literals in a
component. Dark mode is required, not an afterthought — evening
phone-in-hand review is a primary context. The review UI is mobile-first.

### Pull requests

Rebase onto current `main` before opening or force-pushing. Keep `pnpm check`
green. Say in the PR body what you couldn't verify — an honest "I couldn't
test this on a real device" is worth more than silence.

If your change affects what data is collected, retained, or transmitted, it
has to update the privacy policy, terms, or data promise in the *same* PR,
along with `docs/privacy-claims.md`. That's not a follow-up task; it's the
same change, incomplete. Those files are owned by the repository owner in
`.github/CODEOWNERS`, because no test can check whether prose matches an
implementation.

Legal placeholders — operator name, contact, jurisdiction, effective date —
stay as `[[...]]` until a human fills them in. Inventing a value there means
fabricating a legal document.

## Licensing

Stone Soup is AGPL-3.0, from the first commit. Contributions are accepted
under the same license. There is no CLA and no copyright assignment.

If you run a modified version as a network service, the AGPL means you owe
your users the source. That's intentional: this is meant to stay something
people can host and inspect themselves.

## Reporting a problem

Open a GitHub issue. If it's a privacy concern — a string that escaped the
client-side filter, a field that travelled when it shouldn't have — say so
plainly in the title so it gets looked at first.
