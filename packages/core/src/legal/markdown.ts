/**
 * A deliberately tiny Markdown subset renderer for the legal documents:
 * `#`/`##`/`###` headings, blank-line-separated paragraphs, `-` list
 * items, `**bold**`, and `[text](url)` links. Nothing else. Every piece
 * of source text is HTML-escaped before any markdown syntax is applied,
 * so a raw string containing `<`, `>`, `&`, `"` or `'` can never produce
 * a tag, attribute break-out, or entity of its own — this is the only
 * thing standing between the legal prose (plain template-literal text,
 * not attacker input, but still rendered unauthenticated to the open
 * internet) and injected markup. No Markdown dependency is added; the
 * subset above is all these three documents need.
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
function renderInline(escaped: string): string {
  let out = escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
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
