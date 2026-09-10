import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown.js";

// The escaping table: this is the privacy-critical path for the markdown
// renderer (mirroring AGENTS.md's expectation for the anonymization
// filter — the densest case table in the codebase belongs on the
// riskiest logic). These pages are rendered unauthenticated to the open
// internet with no CSP escape hatch beyond "ship no script" (the route's
// CSP is default-src 'none'), so an unescaped `<` here would be a real
// injection, not a theoretical one.
describe("renderMarkdown: escaping", () => {
  it("escapes a literal script tag in a paragraph instead of emitting one", () => {
    const html = renderMarkdown("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes ampersands", () => {
    const html = renderMarkdown("Terms & Conditions");
    expect(html).toContain("Terms &amp; Conditions");
  });

  it("escapes quotes so an attribute cannot be broken out of", () => {
    const html = renderMarkdown(`He said "hi" and wrote it's fine.`);
    expect(html).toContain("&quot;hi&quot;");
    expect(html).toContain("it&#39;s");
  });

  it("escapes a raw < and > even outside a tag-shaped string", () => {
    const html = renderMarkdown("5 < 10 and 10 > 5");
    expect(html).toContain("5 &lt; 10");
    expect(html).toContain("10 &gt; 5");
  });

  it("escapes markup inside a list item", () => {
    const html = renderMarkdown("- <img src=x onerror=alert(1)>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("escapes markup inside a heading", () => {
    const html = renderMarkdown("# <b>not actually bold</b>");
    expect(html).not.toContain("<b>not");
    expect(html).toContain("&lt;b&gt;");
  });

  it("escapes an attacker-controlled link target's quotes", () => {
    const html = renderMarkdown('[click me](javascript:alert(1)"onmouseover="alert(2))');
    // The href value itself is not filtered by scheme (this repo controls
    // every real link target — see privacy.ts/terms.ts/data-promise.ts),
    // but a literal `"` inside it can never break out of the href
    // attribute's own quotes because it was escaped to `&quot;` first.
    expect(html).not.toContain('"onmouseover="alert(2)');
    expect(html).toContain("&quot;onmouseover=&quot;alert(2)");
  });
});

describe("renderMarkdown: supported subset", () => {
  it("renders h1, h2, h3 at their matching levels", () => {
    const html = renderMarkdown("# One\n\n## Two\n\n### Three");
    expect(html).toContain("<h1>One</h1>");
    expect(html).toContain("<h2>Two</h2>");
    expect(html).toContain("<h3>Three</h3>");
  });

  it("joins consecutive non-blank lines into one paragraph", () => {
    const html = renderMarkdown("First line\nsecond line still same paragraph.");
    expect(html).toBe("<p>First line second line still same paragraph.</p>");
  });

  it("separates paragraphs on a blank line", () => {
    const html = renderMarkdown("Paragraph one.\n\nParagraph two.");
    expect(html).toBe("<p>Paragraph one.</p>\n<p>Paragraph two.</p>");
  });

  it("renders a run of - lines as one <ul> of <li> items", () => {
    const html = renderMarkdown("- first\n- second\n- third");
    expect(html).toBe("<ul><li>first</li><li>second</li><li>third</li></ul>");
  });

  it("renders **bold** as <strong>", () => {
    const html = renderMarkdown("This is **important**.");
    expect(html).toBe("<p>This is <strong>important</strong>.</p>");
  });

  it("renders [text](url) as a link", () => {
    const html = renderMarkdown("See [the data promise](/data-promise) for details.");
    expect(html).toBe('<p>See <a href="/data-promise">the data promise</a> for details.</p>');
  });

  it("renders an empty string as empty output", () => {
    expect(renderMarkdown("")).toBe("");
  });
});
