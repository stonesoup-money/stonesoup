/**
 * A deliberately tiny Markdown subset renderer for the legal documents:
 * `#`/`##`/`###` headings, blank-line-separated paragraphs, `-` list
 * items, `**bold**`, `` `code` ``, `---` thematic breaks, and
 * `[text](url)` links. Nothing else. Every piece of source text is
 * HTML-escaped before any markdown syntax is applied, so a raw string
 * containing `<`, `>`, `&`, `"` or `'` can never produce a tag, attribute
 * break-out, or entity of its own — this is the only thing standing
 * between the legal prose (plain template-literal text, not attacker
 * input, but still rendered unauthenticated to the open internet) and
 * injected markup. No Markdown dependency is added; the subset above is
 * all these three documents need.
 *
 * Code-span and thematic-break support (review round 1, finding 7): the
 * legal prose source (privacy.ts, terms.ts, data-promise.ts) uses literal
 * backticks around identifiers like `labeler` and a bare `---` line as a
 * section divider, and until this renderer understood either, those
 * rendered as literal punctuation on the live public pages instead of
 * `<code>` and `<hr>` — the exact page Google's OAuth reviewer opens.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Applied only to already-escaped text, so the capture groups below can
// never themselves introduce an unescaped `<`, `>`, `&`, `"` or `'` — the
// escaping pass has already removed every one of those from the input.
// Code spans are pulled out into placeholders *before* bold/link
// processing and stitched back in afterward, unprocessed — a raw
// identifier inside backticks (`GOLDEN_SET_CONTRIBUTION`, say, or a
// literal `[x](y)`) must render as exactly that text, not have `**` or
// `[...](...)` inside it reinterpreted as markup. Without this,
// substituting `<code>...</code>` first and then running the bold/link
// regexes over the result would still match text sitting between those
// tags, since both are plain string replacements with no notion of "this
// span is already spoken for".
// U+E000 is a Private Use Area codepoint — not a control character (so it
// doesn't trip lint/suspicious/noControlCharactersInRegex the way \u0000
// or another C0 control code would), and not a character any legal-prose
// template literal in this codebase has a reason to contain, so it is
// safe to use as a temporary "this span is spoken for" marker.
const CODE_SPAN_MARKER = "\uE000";

function renderInline(escaped: string): string {
  const codeSpans: string[] = [];
  let out = escaped.replace(/`([^`]+)`/g, (_match, content: string) => {
    const index = codeSpans.push(`<code>${content}</code>`) - 1;
    return `${CODE_SPAN_MARKER}${index}${CODE_SPAN_MARKER}`;
  });
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  const markerPattern = new RegExp(`${CODE_SPAN_MARKER}(\\d+)${CODE_SPAN_MARKER}`, "g");
  out = out.replace(markerPattern, (_match, index: string) => {
    return codeSpans[Number(index)] ?? "";
  });
  return out;
}

/** Renders a Markdown subset (see module comment) to HTML. Escapes first, always. */
export function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      html.push(`<p>${renderInline(escapeHtml(paragraph.join(" ")))}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (listItems.length > 0) {
      html.push(
        `<ul>${listItems.map((item) => `<li>${renderInline(escapeHtml(item))}</li>`).join("")}</ul>`,
      );
      listItems = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line === "") {
      flushParagraph();
      flushList();
      continue;
    }

    // Thematic break: a line of three or more hyphens and nothing else.
    // Checked before the list-item pattern below on purpose — "---" does
    // not match `^-\s+(.*)$` (no space after the first hyphen) so the two
    // never actually collide, but the break is the more specific rule and
    // reads more clearly first.
    if (/^-{3,}$/.test(line)) {
      flushParagraph();
      flushList();
      html.push("<hr>");
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1]?.length ?? 1;
      const text = heading[2] ?? "";
      html.push(`<h${level}>${renderInline(escapeHtml(text))}</h${level}>`);
      continue;
    }

    const listItem = line.match(/^-\s+(.*)$/);
    if (listItem) {
      flushParagraph();
      listItems.push(listItem[1] ?? "");
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();

  return html.join("\n");
}
