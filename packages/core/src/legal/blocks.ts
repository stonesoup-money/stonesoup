/**
 * Block-splitting for the legal documents, and the stable key each block
 * is recorded under in `docs/legal-claim-ledger.md`.
 *
 * Why the ledger exists (review round 3). Three review rounds each fixed
 * the untrue claims a reviewer *named*, and the count went 4 major → 3
 * major → 5 major, because nothing walked every sentence of every
 * rendered output against `docs/privacy-claims.md`, and the claims table
 * itself had no row for several of the pages' normative claims. So the
 * ledger enumerates every block of every rendered output and records the
 * claim row someone decided backs it.
 *
 * What that mapping is, and is not (review round 4). Recording a row
 * against a block proves someone looked and made a decision — it does
 * not, and structurally cannot, prove the decision was correct. A
 * fabricated claim pointed at an unrelated real row stayed green under
 * the old, stricter version of `packages/web/src/legal-claim-coverage.test.ts`,
 * because no machine check can compare prose to an implementation. That
 * test now only guards the ledger's own mechanical integrity (parses,
 * unique keys, no stale or missing entries); `.github/CODEOWNERS` is the
 * actual claim-truth gate, via required human review of this directory
 * and the generated docs.
 *
 * "Block" here means exactly what packages/core/src/legal/markdown.ts
 * renders as one element: a heading, a `-` list item, or a
 * blank-line-separated paragraph. Splitting on blocks rather than on
 * sentences avoids the abbreviation-and-decimal guesswork of sentence
 * segmentation, and is strictly finer-grained than sections — which
 * matters, because review round 3's finding 4 was an unmarked cookie
 * bullet sitting directly beside a correctly marked Gmail bullet in the
 * same list.
 */

export type LegalBlockKind = "heading" | "paragraph" | "list-item";

export interface LegalBlock {
  kind: LegalBlockKind;
  /** The block's text, whitespace-normalized — the exact string the key is computed from. */
  text: string;
  /**
   * For a list item, the normalized text of the paragraph the list hangs
   * off, when the list follows one directly. A list whose introduction
   * carries the unbuilt marker ("…and it contains:") marks its items
   * too — the reader meets the marker immediately above the bullets. A
   * list that hangs straight off a heading has no intro, so each item
   * must carry its own marker; that is the finding-4 case.
   */
  introText?: string;
}

const WHITESPACE = /\s+/g;

/** Normalizes a block's text the way markdown.ts joins it: one space between words. */
export function normalizeBlockText(text: string): string {
  return text.replace(WHITESPACE, " ").trim();
}

/**
 * FNV-1a (32-bit), hex, 8 characters. A short content key, not a
 * security hash: it exists so `docs/legal-claim-ledger.md` can name a
 * block without reprinting a 900-character paragraph, and so any edit to
 * a block's words produces a different key and forces the ledger entry
 * to be revisited. The ledger also stores an excerpt of each block,
 * which the coverage test checks against the live text, so a key
 * collision cannot let a mislabeled block through unnoticed.
 */
export function legalBlockKey(text: string): string {
  let hash = 0x811c9dc5;
  const normalized = normalizeBlockText(text);
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    // FNV prime, 32-bit, via shifts so this stays in integer range.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** The human-readable excerpt the ledger carries beside each key. */
export const LEGAL_BLOCK_EXCERPT_LENGTH = 72;

export function legalBlockExcerpt(text: string): string {
  const normalized = normalizeBlockText(text);
  return normalized.length <= LEGAL_BLOCK_EXCERPT_LENGTH
    ? normalized
    : `${normalized.slice(0, LEGAL_BLOCK_EXCERPT_LENGTH)}…`;
}

/**
 * Splits a legal document's markdown into the blocks markdown.ts would
 * render. Thematic breaks (`---`) carry no text and are skipped.
 */
export function splitLegalBlocks(markdown: string): LegalBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: LegalBlock[] = [];
  let paragraph: string[] = [];
  // The paragraph a currently-open list run hangs off, if any.
  let listIntro: string | undefined;
  let inList = false;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      const text = normalizeBlockText(paragraph.join(" "));
      blocks.push({ kind: "paragraph", text });
      paragraph = [];
      // A paragraph immediately before a list is that list's intro.
      listIntro = text;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line === "") {
      flushParagraph();
      continue;
    }

    if (/^-{3,}$/.test(line)) {
      flushParagraph();
      listIntro = undefined;
      inList = false;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      listIntro = undefined;
      inList = false;
      blocks.push({ kind: "heading", text: normalizeBlockText(heading[2] ?? "") });
      continue;
    }

    const listItem = line.match(/^-\s+(.*)$/);
    if (listItem) {
      flushParagraph();
      inList = true;
      const text = normalizeBlockText(listItem[1] ?? "");
      blocks.push(
        listIntro === undefined
          ? { kind: "list-item", text }
          : { kind: "list-item", text, introText: listIntro },
      );
      continue;
    }

    // A paragraph line ends any open list run, so the next list's intro
    // is not inherited from a list two paragraphs ago.
    if (inList) {
      inList = false;
      listIntro = undefined;
    }
    paragraph.push(line);
  }

  flushParagraph();
  return blocks;
}
