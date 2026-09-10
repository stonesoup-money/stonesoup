import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEGAL_CONTEXT,
  DEFAULT_OPERATOR_CONTACT,
  DEFAULT_OPERATOR_NAME,
  type LegalContext,
} from "./context.js";
import { LEGAL_DOCUMENTS } from "./documents.js";
import { renderMarkdown } from "./markdown.js";

/**
 * The legal prose may only use the Markdown constructs markdown.ts
 * actually implements — checked against the *source*, in both deployment
 * modes (review round 2 finding 4; review round 3 finding 6).
 *
 * This bug has now recurred three times through three different
 * characters: backticks and `---` (round 1, finding 7), single-asterisk
 * emphasis (round 2, finding 4), and then round 3 demonstrated that
 * injecting `_underscore_`, a `#### heading`, a reference link
 * `[the ToS][terms-ref]`, and `1.` / `2.` ordered-list markers left the
 * rendered-output check green while the renderer emitted all four as
 * literal text on the live page. The rendered-output check is a
 * blocklist of the syntax characters someone thought of; it cannot catch
 * the next character nobody thought of, and it only ever ran against
 * self-hosted output.
 *
 * So this is the other shape: an allowlist grammar over the source. A
 * line is a blank, a `#`/`##`/`###` heading, a `- ` list item, a `---`
 * thematic break after a blank line, or a paragraph line — and its
 * inline content may only use `**bold**`, `*emphasis*`, `` `code` ``,
 * `[text](url)`, and the `[[...]]` unfilled-fact placeholder. Anything
 * else is a construct this renderer does not implement, which means it
 * would reach the open internet as literal punctuation on the page
 * Google's OAuth reviewer opens.
 */

const hostedUnfilledContext: LegalContext = {
  mode: "hosted",
  operatorName: DEFAULT_OPERATOR_NAME,
  operatorContact: DEFAULT_OPERATOR_CONTACT,
};

const CONTEXTS: readonly { label: string; ctx: LegalContext }[] = [
  { label: "self-hosted", ctx: DEFAULT_LEGAL_CONTEXT },
  { label: "hosted", ctx: hostedUnfilledContext },
];

const PLACEHOLDER = /\[\[[^[\]]*\]\]/g;
const CODE_SPAN = /`[^`]*`/g;
const INLINE_LINK = /\[[^[\]]+\]\([^()]+\)/g;

/**
 * Returns one message per construct the renderer does not implement.
 * Empty means the source is inside the supported subset.
 */
export function unsupportedMarkdownConstructs(markdown: string): string[] {
  const problems: string[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");

  lines.forEach((line, index) => {
    const where = `line ${index + 1}: ${line.slice(0, 70)}`;
    const report = (what: string) => problems.push(`${what} — ${where}`);

    if (line !== line.trimEnd()) report("trailing whitespace (a hard line break markdown drops)");
    if (/^[ \t]+\S/.test(line)) report("leading indentation (indented code block)");
    if (line.includes("\t")) report("tab character");
    if (line.trim() === "") return;

    const trimmed = line.trim();

    if (trimmed.startsWith("#") && !/^#{1,3} \S/.test(trimmed)) {
      report("heading level the renderer does not implement (only #, ##, ###)");
    }
    if (/^\d+[.)]\s/.test(trimmed)) report("ordered list marker (renderer has no <ol>)");
    if (/^[*+]\s/.test(trimmed)) report("`*`/`+` list marker (only `- ` is implemented)");
    if (/^>/.test(trimmed)) report("blockquote (not implemented)");
    if (/^={2,}$/.test(trimmed)) report("setext heading underline (not implemented)");
    if (/^-{3,}$/.test(trimmed) && (lines[index - 1] ?? "").trim() !== "") {
      report("`---` directly under text renders as a break, not a setext heading");
    }
    if (trimmed.includes("```") || trimmed.includes("~")) report("code fence or strikethrough");
    if (trimmed.includes("|")) report("table syntax (not implemented)");
    if (trimmed.includes("\\")) report("backslash escape (not implemented)");
    if (/[<>]/.test(trimmed)) report("angle bracket (escaped to literal text, and no autolinks)");
    if (trimmed.includes("![")) report("image syntax (not implemented)");

    const backticks = (trimmed.match(/`/g) ?? []).length;
    if (backticks % 2 !== 0) report("unbalanced code-span backtick");

    // Strip every construct the renderer *does* implement, then look at
    // what is left: anything with markdown meaning that survives is a
    // construct this renderer would emit as literal text.
    const stripped = trimmed
      .replace(CODE_SPAN, "")
      .replace(PLACEHOLDER, "")
      .replace(INLINE_LINK, "");

    if (stripped.includes("_")) {
      report(
        "underscore outside a code span (renderer has no `_emphasis_`; wrap identifiers in backticks)",
      );
    }
    if (/[[\]]/.test(stripped)) {
      report("bracket that is not an inline `[text](url)` link or a `[[placeholder]]`");
    }

    const withoutBold = stripped.replace(/\*\*[^*]+\*\*/g, "");
    const strays = (withoutBold.match(/\*/g) ?? []).length;
    if (strays % 2 !== 0) report("unbalanced emphasis asterisk");
  });

  return problems;
}

describe.each(CONTEXTS)(
  "legal prose uses only the implemented markdown subset ($label)",
  ({ ctx }) => {
    it.each(LEGAL_DOCUMENTS)("$slug source", (doc) => {
      expect(unsupportedMarkdownConstructs(doc.markdown(ctx))).toEqual([]);
    });

    it.each(LEGAL_DOCUMENTS)("$slug rendered output has no leftover syntax", (doc) => {
      // The complementary blocklist, kept because it inspects the bytes a
      // browser receives — and unlike pages.test.ts's version, this one
      // runs in hosted mode too.
      const html = renderMarkdown(doc.markdown(ctx));
      const textOnly = html.replace(/<[^>]*>/g, "");
      expect(textOnly, "literal backtick in rendered text").not.toContain("`");
      expect(textOnly, "literal ** in rendered text").not.toContain("**");
      expect(textOnly, "literal * in rendered text").not.toContain("*");
      expect(textOnly, "literal markdown link syntax in rendered text").not.toMatch(/\]\([^)]*\)/);
      expect(textOnly, "unrendered thematic break").not.toMatch(/^\s*-{3,}\s*$/m);
    });
  },
);

describe("the grammar check itself catches the constructs review round 3 injected", () => {
  // Round 3 injected each of these into the prose and watched the old
  // rendered-output test stay green. Each must now be a failure.
  it.each([
    ["underscore emphasis", "This is _instance_ text."],
    ["level-four heading", "#### A heading"],
    ["reference link", "See [the ToS][terms-ref] for more."],
    ["ordered list", "1. First item"],
    ["second ordered item", "2. Second item"],
    ["setext heading", "A heading\n==="],
    ["blockquote", "> quoted"],
    ["table row", "| a | b |"],
    ["code fence", "```ts"],
    ["indented code", "    const x = 1;"],
    ["strikethrough", "This is ~~gone~~."],
    ["autolink", "Visit <https://example.com>."],
    ["image", "![alt](https://example.com/a.png)"],
    ["unbalanced backtick", "A `code span that never closes."],
    ["unbalanced emphasis", "An *emphasis that never closes."],
  ])("rejects %s", (_label, snippet) => {
    expect(unsupportedMarkdownConstructs(snippet).length).toBeGreaterThan(0);
  });

  it("accepts the constructs the renderer does implement", () => {
    const supported = [
      "# Heading one",
      "",
      "## Heading two",
      "",
      "A paragraph with **bold**, *emphasis*, `code_span`, and a [link](/terms).",
      "",
      "- A list item with `GOLDEN_SET_CONTRIBUTION` in it.",
      "- Another one.",
      "",
      "[[PLACEHOLDER_NAME — a human must fill this in]]",
      "",
      "---",
      "",
      "Last line.",
    ].join("\n");
    expect(unsupportedMarkdownConstructs(supported)).toEqual([]);
  });
});
