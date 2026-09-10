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
  UNBUILT_MARKER,
} from "@stonesoup/core";
import { describe, expect, it } from "vitest";
import ledgerSource from "../../../docs/legal-claim-ledger.md?raw";
import claimsSource from "../../../docs/privacy-claims.md?raw";

/**
 * The claims-coverage gate (review round 3).
 *
 * Three review rounds of spot fixes on these pages went 4 major → 3
 * major → 5 major. The reviewer's diagnosis was that each round fixed
 * the untrue claims someone *named*, nobody had walked every sentence
 * against `docs/privacy-claims.md`, and the table itself had no row for
 * several of the pages' claims — so "check the table" could not close it
 * either. A table that can be silently under-populated cannot be a
 * guard.
 *
 * This test makes it one, by checking coverage in both directions:
 * every rendered block must name a claim row, and every row tagged with
 * a document must be named by a block. The failure that matters is the
 * first one — it fires on a *new* unbacked claim, not just on today's,
 * because a new sentence is a new block with a new key and no ledger
 * entry. The rest of the checks stop the ledger itself from rotting.
 *
 * It runs in the `web` Vitest project for the same reason
 * legal-docs-drift.test.ts does: Vite's `?raw` import works here, and
 * these two markdown files are the inputs.
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

interface ClaimRow {
  id: string;
  claim: string;
  status: string;
  marker: string;
  /** True when the claim names one of the three documents in parentheses. */
  isProseClaim: boolean;
}

function parseClaimRows(markdown: string): Map<string, ClaimRow> {
  const rows = new Map<string, ClaimRow>();
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 5) continue;
    const id = cells[0] ?? "";
    if (!/^\d+$/.test(id)) continue;
    const claim = cells[1] ?? "";
    rows.set(`C${id}`, {
      id: `C${id}`,
      claim,
      status: cells[2] ?? "",
      marker: cells[3] ?? "",
      isProseClaim: /\([^)]*\b(?:privacy|terms|data-promise)\b[^)]*\)/.test(claim),
    });
  }
  return rows;
}

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

/**
 * A block satisfies the unbuilt marker itself, or through the paragraph
 * its list hangs off — "…and it contains:" carrying the marker marks the
 * bullets under it, because the reader meets the marker immediately
 * above them. A list hanging straight off a heading has no such intro,
 * so each of its items must carry its own marker; that is exactly review
 * round 3's finding 4, an unmarked cookie bullet beside a correctly
 * marked Gmail bullet in the same list.
 */
function carriesUnbuiltMarker(block: LegalBlock): boolean {
  return (
    block.text.includes(UNBUILT_MARKER) || (block.introText?.includes(UNBUILT_MARKER) ?? false)
  );
}

const claimRows = parseClaimRows(claimsSource);
const ledgerEntries = parseLedger(ledgerSource);
const ledgerByKey = new Map(ledgerEntries.map((entry) => [entry.key, entry]));
const blocks = renderedBlocks();

describe("docs/privacy-claims.md parses as a claims table", () => {
  it("has rows, each with a Marker column value from the controlled vocabulary", () => {
    expect(claimRows.size).toBeGreaterThan(20);
    for (const row of claimRows.values()) {
      expect(
        ["required", "placeholder", "not required"],
        `claim row ${row.id} has Marker "${row.marker}", which is not one of required / placeholder / not required`,
      ).toContain(row.marker);
    }
  });

  it("the ledger parses, with no duplicate keys", () => {
    expect(ledgerEntries.length).toBeGreaterThan(20);
    expect(ledgerByKey.size, "docs/legal-claim-ledger.md has duplicate keys").toBe(
      ledgerEntries.length,
    );
  });
});

describe("every rendered block is covered by the claim ledger", () => {
  // The load-bearing direction. A new sentence anywhere in privacy.ts,
  // terms.ts or data-promise.ts — in either deployment mode — is a new
  // block with a new key and no ledger entry, and fails here until
  // someone decides, in a diff a reviewer can see, which claim row backs
  // it.
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
        "or `--` if it asserts nothing about behaviour. If it asserts that something exists and " +
        "no row covers it, add a row — that is the whole point of this gate:\n" +
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

  it("every ledger excerpt still matches the block it keys", () => {
    const mismatched: string[] = [];
    for (const entry of ledgerEntries) {
      const found = blocks.get(entry.key);
      if (!found) continue;
      const expected = legalBlockExcerpt(found.block.text);
      if (expected !== entry.excerpt) {
        mismatched.push(`${entry.key}: ledger says "${entry.excerpt}", block reads "${expected}"`);
      }
    }
    expect(mismatched, "ledger excerpts out of date").toEqual([]);
  });

  it("every claim a ledger entry names exists in docs/privacy-claims.md", () => {
    const unknown: string[] = [];
    for (const entry of ledgerEntries) {
      for (const claim of entry.claims) {
        if (!claimRows.has(claim)) unknown.push(`${entry.key} names ${claim}`);
      }
    }
    expect(unknown, "ledger entries naming a nonexistent claim row").toEqual([]);
  });
});

describe("every claim row is backed by prose, and every unbuilt claim carries its marker", () => {
  it("no claim row tagged with a document is left unreferenced by any block", () => {
    const referenced = new Set(ledgerEntries.flatMap((entry) => entry.claims));
    const dead: string[] = [];
    for (const row of claimRows.values()) {
      if (!row.isProseClaim) continue;
      if (!referenced.has(row.id)) dead.push(`${row.id}: ${row.claim.slice(0, 90)}`);
    }
    expect(
      dead,
      "these claim rows name a document but no rendered block references them — either the prose " +
        "that made the claim was removed (delete the row) or the ledger is out of date",
    ).toEqual([]);
  });

  it("every block whose row is marked `required` carries the not-yet-built marker", () => {
    const unmarked: string[] = [];
    for (const entry of ledgerEntries) {
      const found = blocks.get(entry.key);
      if (!found) continue;
      const requiring = entry.claims.filter((claim) => claimRows.get(claim)?.marker === "required");
      if (requiring.length === 0) continue;
      if (!carriesUnbuiltMarker(found.block)) {
        unmarked.push(`${entry.key} (${requiring.join(",")}): ${entry.excerpt}`);
      }
    }
    expect(
      unmarked,
      `these blocks claim something that is not built and do not carry "${UNBUILT_MARKER}" — add ` +
        "the marker at the point of the claim, or change the claim",
    ).toEqual([]);
  });

  it("every block whose row is marked `placeholder` carries an unfilled-fact marker", () => {
    const unmarked: string[] = [];
    for (const entry of ledgerEntries) {
      const found = blocks.get(entry.key);
      if (!found) continue;
      const requiring = entry.claims.filter(
        (claim) => claimRows.get(claim)?.marker === "placeholder",
      );
      if (requiring.length === 0) continue;
      if (!found.block.text.includes("[[")) {
        unmarked.push(`${entry.key} (${requiring.join(",")}): ${entry.excerpt}`);
      }
    }
    expect(
      unmarked,
      "these blocks state a hosted-mode fact that must render as an unfilled `[[...]]` placeholder",
    ).toEqual([]);
  });

  it("no block marked `--` carries the marker — a claim needing a marker needs a row", () => {
    const smuggled: string[] = [];
    for (const entry of ledgerEntries) {
      if (entry.claims.length > 0) continue;
      const found = blocks.get(entry.key);
      if (found?.block.text.includes(UNBUILT_MARKER))
        smuggled.push(`${entry.key}: ${entry.excerpt}`);
    }
    expect(
      smuggled,
      "a block carrying the not-yet-built marker is by definition an unbuilt claim: give it a row " +
        "in docs/privacy-claims.md instead of `--`",
    ).toEqual([]);
  });
});
