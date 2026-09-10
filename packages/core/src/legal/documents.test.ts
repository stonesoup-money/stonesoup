import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEGAL_CONTEXT,
  DEFAULT_OPERATOR_CONTACT,
  DEFAULT_OPERATOR_NAME,
  LEGAL_LAST_UPDATED,
  type LegalContext,
} from "./context.js";
import { getLegalDocument, LEGAL_DOCUMENTS, PUBLIC_ROUTE_PATHS } from "./documents.js";

const hostedFilledContext: LegalContext = {
  mode: "hosted",
  operatorName: "Stone Soup Hosting, Inc.",
  operatorContact: "privacy@example.com",
};

const hostedUnfilledContext: LegalContext = {
  mode: "hosted",
  operatorName: DEFAULT_OPERATOR_NAME,
  operatorContact: DEFAULT_OPERATOR_CONTACT,
};

describe("LEGAL_DOCUMENTS registry", () => {
  it("lists exactly the three public legal routes", () => {
    expect(PUBLIC_ROUTE_PATHS).toEqual(["/privacy", "/terms", "/data-promise"]);
  });

  it("resolves a document by slug", () => {
    expect(getLegalDocument("privacy")?.path).toBe("/privacy");
    expect(getLegalDocument("nonexistent")).toBeUndefined();
  });
});

describe("LEGAL_LAST_UPDATED", () => {
  it("parses as a valid ISO 8601 date", () => {
    expect(LEGAL_LAST_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(new Date(LEGAL_LAST_UPDATED).getTime())).toBe(false);
  });
});

describe.each(LEGAL_DOCUMENTS)("document: $slug", (doc) => {
  it("renders non-empty markdown in self-hosted mode", () => {
    const markdown = doc.markdown(DEFAULT_LEGAL_CONTEXT);
    expect(markdown.trim().length).toBeGreaterThan(0);
  });

  it("contains no TODO marker", () => {
    const markdown = doc.markdown(DEFAULT_LEGAL_CONTEXT);
    expect(markdown).not.toMatch(/TODO/);
  });

  it("self-hosted mode renders with no unfilled-fact placeholder — a self-hoster needs no legal entity or jurisdiction", () => {
    const markdown = doc.markdown(DEFAULT_LEGAL_CONTEXT);
    expect(markdown).not.toContain("[[");
  });

  it("mentions the document's own title", () => {
    const markdown = doc.markdown(DEFAULT_LEGAL_CONTEXT);
    expect(markdown).toContain(doc.title);
  });
});

describe("hosted mode with unfilled operator identity", () => {
  it("privacy renders visible placeholders rather than fabricated facts", () => {
    const markdown = getLegalDocument("privacy")?.markdown(hostedUnfilledContext) ?? "";
    expect(markdown).toContain(DEFAULT_OPERATOR_NAME);
    expect(markdown).toContain(DEFAULT_OPERATOR_CONTACT);
    expect(markdown).toContain("[[GOVERNING_JURISDICTION");
    expect(markdown).toContain("[[EFFECTIVE_DATE");
  });

  it("terms renders visible placeholders rather than fabricated facts", () => {
    const markdown = getLegalDocument("terms")?.markdown(hostedUnfilledContext) ?? "";
    expect(markdown).toContain(DEFAULT_OPERATOR_NAME);
    expect(markdown).toContain("[[GOVERNING_JURISDICTION");
  });
});

describe("hosted mode with a real operator identity", () => {
  it("privacy names the operator and has no placeholder for the identity fields", () => {
    const markdown = getLegalDocument("privacy")?.markdown(hostedFilledContext) ?? "";
    expect(markdown).toContain("Stone Soup Hosting, Inc.");
    expect(markdown).toContain("privacy@example.com");
    // Jurisdiction and effective date are still their own placeholders —
    // they are not supplied by OPERATOR_NAME/OPERATOR_CONTACT.
    expect(markdown).toContain("[[GOVERNING_JURISDICTION");
  });
});

describe("privacy.ts required sections", () => {
  const markdown = getLegalDocument("privacy")?.markdown(DEFAULT_LEGAL_CONTEXT) ?? "";

  it("has the Google user data and Limited Use section Google's review reads", () => {
    expect(markdown).toContain("Google user data and Limited Use");
    expect(markdown).toContain("Limited Use");
    expect(markdown).toContain("sender-domain allowlist");
    expect(markdown).toContain("email body is discarded entirely");
  });

  it("names the exact third parties and no others by omission of analytics/ad language", () => {
    expect(markdown).toContain("Anthropic");
    expect(markdown).toContain("Cloudflare");
    expect(markdown).toContain("Google");
    expect(markdown).toMatch(/no analytics/i);
  });

  it("states there is no operator access to user data", () => {
    expect(markdown).toMatch(/no admin/i);
  });

  it("links to /data-promise for what leaves the instance", () => {
    expect(markdown).toContain("/data-promise");
  });
});

describe("terms.ts required content", () => {
  it("self-hosted mode states AGPL-3.0 and no warranty", () => {
    const markdown = getLegalDocument("terms")?.markdown(DEFAULT_LEGAL_CONTEXT) ?? "";
    expect(markdown).toContain("AGPL-3.0");
    expect(markdown).toMatch(/without warranty/i);
  });

  it("hosted mode states labels are the payment and does not offer a paid private tier", () => {
    const markdown = getLegalDocument("terms")?.markdown(hostedFilledContext) ?? "";
    expect(markdown).toContain("CC0");
    expect(markdown).toMatch(/no paid tier/i);
  });
});

describe("data-promise.ts required content", () => {
  const markdown = getLegalDocument("data-promise")?.markdown(DEFAULT_LEGAL_CONTEXT) ?? "";

  it("lists the golden_set record fields that leave the machine", () => {
    expect(markdown).toContain("raw line text");
    expect(markdown).toContain("labeler");
    expect(markdown).toContain("taxonomy_version");
    expect(markdown).toContain("split");
  });

  it("states what never leaves the machine", () => {
    expect(markdown).toMatch(/no receipt image/i);
    expect(markdown).toMatch(/no receipt id/i);
    expect(markdown).toMatch(/no user id/i);
  });

  it("states the CC0 license and citation request", () => {
    expect(markdown).toContain("CC0");
    expect(markdown).toMatch(/citation/i);
  });

  it("states the permanent human sample review before publication", () => {
    expect(markdown).toMatch(/human maintainer/i);
    expect(markdown).toMatch(/permanent/i);
  });

  it("discloses that a printed line often carries its own price", () => {
    expect(markdown).toMatch(/carries its own price|carry.{0,20}own price/i);
  });
});
