import {
  DEFAULT_LEGAL_CONTEXT,
  DEFAULT_OPERATOR_CONTACT,
  DEFAULT_OPERATOR_NAME,
  getLegalDocument,
  type LegalBlock,
  type LegalContext,
  legalBlockExcerpt,
  legalBlockKey,
  splitLegalBlocks,
} from "@stonesoup/core";
import { describe, expect, it } from "vitest";
import ledgerSource from "../../../docs/legal-claim-ledger.md?raw";

/**
 * The claim ledger's mechanical integrity checks — demoted from a
 * claim-truth gate to an advisory drift reminder (STON-13 final pass;
 * decisions.md).
 *
 * This file used to assert, in both directions, that every rendered
 * block named a claim row in `docs/legal-claim-ledger.md` and every
 * document-tagged row in `docs/privacy-claims.md` was named by some
 * block — and treated that mapping as proof a claim was true. A fourth
 * review round showed the ceiling of that approach: a fabricated claim
 * ("all receipt images are encrypted at rest with a per-account key the
 * operator cannot read"), appended to an existing paragraph and pointed
 * at an unrelated real row, stayed 229/229 green. The test only ever
 * checked that a block *names* a row — never that the row's free-text
 * evidence actually *supports* that block's words — because no machine
 * check can tell whether prose matches an implementation. That is a
 * judgment call, not a fact.
 *
 * The human ruling: stop pretending this file closes that loop. The
 * real claim-truth gate is now a human one: `.github/CODEOWNERS`
 * requires the repo owner's review on `packages/core/src/legal/**` and
 * the generated `docs/privacy*.md`, `docs/terms*.md`,
 * `docs/data-promise*.md`, `docs/privacy-claims.md`, and
 * `docs/legal-claim-ledger.md`.
 *
 * What stays here, still gating `pnpm check`, is only what a machine
 * genuinely *can* verify about the ledger as a data structure — not
 * about the claims it names — and is useful purely as a drift
 * reminder: the ledger parses and its keys are unique, no ledger entry
 * points at a block that is no longer rendered, and every rendered
 * block has at least one ledger entry (so a new sentence cannot land
 * with zero paper trail at all). None of that says whether the row a
 * block points at actually backs the block's words — that gap is
 * exactly what CODEOWNERS review exists to cover instead.
 */

const hostedUnfilledContext: LegalContext = {
  mode: "hosted",
  operatorName: DEFAULT_OPERATOR_NAME,
  operatorContact: DEFAULT_OPERATOR_CONTACT,
};

const RENDERINGS: readonly { label: string; slug: string; ctx: LegalContext }[] = [
  { label: "docs/privacy.md", slug: "privacy", ctx: DEFAULT_LEGAL_CONTEXT },
  { label: "docs/terms.md", slug: "terms", ctx: DEFAULT_LEGAL_CONTEXT },
  { label: "docs/data-promise.md", slug: "data-promise", ctx: DEFAULT_LEGAL_CONTEXT },
  { label: "docs/privacy.hosted.md", slug: "privacy", ctx: hostedUnfilledContext },
  { label: "docs/terms.hosted.md", slug: "terms", ctx: hostedUnfilledContext },
  { label: "docs/data-promise.hosted.md", slug: "data-promise", ctx: hostedUnfilledContext },
];

interface LedgerEntry {
  key: string;
  claims: string[];
  excerpt: string;
}

function parseLedger(markdown: string): LedgerEntry[] {
  const entries: LedgerEntry[] = [];
  for (const line of markdown.split("\n")) {
    const match = line.match(/^- `([0-9a-f]{8})` \[([^\]]+)\] (.*)$/);
    if (!match) continue;
    const raw = match[2] ?? "";
    entries.push({
      key: match[1] ?? "",
      claims: raw === "--" ? [] : raw.split(",").map((claim) => claim.trim()),
      excerpt: match[3] ?? "",
    });
  }
  return entries;
}

/** Every distinct block across all six rendered outputs, keyed as the ledger keys it. */
function renderedBlocks(): Map<string, { block: LegalBlock; renderings: string[] }> {
  const blocks = new Map<string, { block: LegalBlock; renderings: string[] }>();
  for (const rendering of RENDERINGS) {
    const markdown = getLegalDocument(rendering.slug)?.markdown(rendering.ctx) ?? "";
    expect(markdown.length, `no markdown rendered for ${rendering.label}`).toBeGreaterThan(0);
    for (const block of splitLegalBlocks(markdown)) {
      const key = legalBlockKey(block.text);
      const existing = blocks.get(key);
      if (existing) {
        existing.renderings.push(rendering.label);
        continue;
      }
      blocks.set(key, { block, renderings: [rendering.label] });
    }
  }
  return blocks;
}

const ledgerEntries = parseLedger(ledgerSource);
const ledgerByKey = new Map(ledgerEntries.map((entry) => [entry.key, entry]));
const blocks = renderedBlocks();

describe("docs/legal-claim-ledger.md is structurally sound", () => {
  it("parses, with no duplicate keys", () => {
    expect(ledgerEntries.length).toBeGreaterThan(20);
    expect(ledgerByKey.size, "docs/legal-claim-ledger.md has duplicate keys").toBe(
      ledgerEntries.length,
    );
  });
});

describe("every rendered block has a ledger entry (drift reminder, not a truth check)", () => {
  // Coverage only: a new sentence anywhere in privacy.ts, terms.ts, or
  // data-promise.ts — in either deployment mode — is a new block with a
  // new key and no ledger entry, and fails here until someone adds one.
  // Adding an entry records that *someone looked* and picked a row; it
  // does not, and cannot, prove the row is correct — see the module
  // comment above.
  it("no rendered block is missing from docs/legal-claim-ledger.md", () => {
    const missing: string[] = [];
    for (const [key, { block, renderings }] of blocks) {
      if (ledgerByKey.has(key)) continue;
      missing.push(
        `- \`${key}\` [??] ${legalBlockExcerpt(block.text)}   <-- ${renderings.join(", ")}`,
      );
    }
    expect(
      missing,
      "these rendered blocks have no entry in docs/legal-claim-ledger.md. Paste each line into " +
        "its Ledger section and replace ?? with the docs/privacy-claims.md row(s) that back it, " +
        "or `--` if it asserts nothing about behaviour:\n" +
        missing.join("\n"),
    ).toEqual([]);
  });

  it("no ledger entry names a block that is no longer rendered", () => {
    const stale = ledgerEntries
      .filter((entry) => !blocks.has(entry.key))
      .map((entry) => `${entry.key} (${entry.excerpt})`);
    expect(
      stale,
      "these docs/legal-claim-ledger.md entries no longer match any rendered block — the prose " +
        "they keyed was edited or removed; delete or re-key them",
    ).toEqual([]);
  });
});
