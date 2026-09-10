import { env } from "cloudflare:test";
import {
  BACKFILL_WINDOW_DAYS,
  DEFAULT_LEGAL_CONTEXT,
  GOLDEN_SET_CONTRIBUTION_DEFAULT,
  GOLDEN_SET_SUBMISSION_ALLOWLIST,
  GOLDEN_SET_SUBMISSION_EXCLUDED_COLUMNS,
  GOLDEN_SET_SUBMISSION_PSEUDONYMIZED_COLUMNS,
  getLegalDocument,
} from "@stonesoup/core";
import { describe, expect, it } from "vitest";

/**
 * The accuracy harness (STON-13 plan, "Accuracy: how a reviewer knows it
 * is true, not plausible"). docs/privacy-claims.md is the human-readable
 * claims-to-evidence table; this file is the subset of those claims that
 * are machine-checkable, so a later ticket cannot silently drift the
 * schema or a config default away from what the privacy policy asserts
 * without a red `pnpm check`.
 *
 * The `PRAGMA table_info(golden_set)` query below is the one read-only
 * exception the STON-13 gate explicitly allows (see AGENTS.md and the
 * ticket plan's "Reviewer check" line): it is schema introspection, not
 * a read of golden_set's contents, makes no network call, and proves
 * exactly one thing — that the anonymization boundary columns this
 * ticket's privacy policy claims do not exist really do not exist.
 */

describe("golden_set schema matches the anonymization claims in /data-promise", () => {
  it("has no receipt id, user id, store, purchase-timestamp, or image-key column", async () => {
    const { results } = await env.DB.prepare("PRAGMA table_info(golden_set)").all<{
      name: string;
    }>();
    const columnNames = results.map((row) => row.name);

    // "What never leaves your machine" in data-promise.ts names these
    // five concepts explicitly; this is the boundary enforced by the
    // absence of a column, not by a runtime filter.
    const bannedPatterns = [
      /receipt_?id/i,
      /^user_?id$/i,
      /\bstore\b/i,
      /purchase.*time|purchased_at/i,
      /image/i,
    ];
    for (const pattern of bannedPatterns) {
      const offending = columnNames.filter((name) => pattern.test(name));
      expect(offending, `golden_set columns matching ${pattern}: ${offending.join(", ")}`).toEqual(
        [],
      );
    }
  });

  it("has the fields the data promise says do leave the machine", async () => {
    const { results } = await env.DB.prepare("PRAGMA table_info(golden_set)").all<{
      name: string;
    }>();
    const columnNames = results.map((row) => row.name);
    for (const expected of [
      "raw_string",
      "merchant_type",
      "model_category",
      "model_confidence",
      "verdict",
      "corrected_category",
      "labeler",
      "routing_reason",
      "taxonomy_version",
      "schema_version",
      "split",
    ]) {
      expect(columnNames).toContain(expected);
    }
  });

  it("labeler is NOT NULL — kept at write time, not nulled (pseudonymized at the instance boundary on submission, not at export)", async () => {
    const { results } = await env.DB.prepare("PRAGMA table_info(golden_set)").all<{
      name: string;
      notnull: number;
    }>();
    const labeler = results.find((row) => row.name === "labeler");
    expect(labeler?.notnull).toBe(1);
  });
});

describe("the golden-set submission payload allowlist is exhaustive (review round 1, finding 3)", () => {
  // finding 3's whole complaint: the two tests above assert eleven-then-
  // more columns are *present*, but never that the set the policy
  // describes as leaving this instance is *closed*. These tests make
  // that assertion for real, against the live schema, so a column added
  // to golden_set later without an update to
  // packages/core/src/legal/submission-fields.ts fails `pnpm check`
  // instead of silently riding along in — or silently being left out
  // of — what /data-promise says leaves this instance.
  it("every golden_set column is categorized as allowlisted, pseudonymized, or excluded — none left uncategorized", async () => {
    const { results } = await env.DB.prepare("PRAGMA table_info(golden_set)").all<{
      name: string;
    }>();
    const columnNames = results.map((row) => row.name);

    const categorized = new Set([
      ...GOLDEN_SET_SUBMISSION_ALLOWLIST,
      ...GOLDEN_SET_SUBMISSION_PSEUDONYMIZED_COLUMNS,
      ...GOLDEN_SET_SUBMISSION_EXCLUDED_COLUMNS,
    ]);

    const uncategorized = columnNames.filter((name) => !categorized.has(name));
    expect(
      uncategorized,
      `golden_set column(s) not categorized in packages/core/src/legal/submission-fields.ts: ${uncategorized.join(", ")}. ` +
        "Add each to exactly one of GOLDEN_SET_SUBMISSION_ALLOWLIST / " +
        "_PSEUDONYMIZED_COLUMNS / _EXCLUDED_COLUMNS, and update data-promise.ts's prose to match.",
    ).toEqual([]);
  });

  it("nothing in the allowlist/pseudonymize/exclude sets names a column that doesn't actually exist", async () => {
    const { results } = await env.DB.prepare("PRAGMA table_info(golden_set)").all<{
      name: string;
    }>();
    const columnNames = new Set(results.map((row) => row.name));

    for (const name of [
      ...GOLDEN_SET_SUBMISSION_ALLOWLIST,
      ...GOLDEN_SET_SUBMISSION_PSEUDONYMIZED_COLUMNS,
      ...GOLDEN_SET_SUBMISSION_EXCLUDED_COLUMNS,
    ]) {
      expect(
        columnNames.has(name),
        `submission-fields.ts names "${name}", not a real golden_set column`,
      ).toBe(true);
    }
  });

  it("the three category sets are disjoint — no column is categorized twice", () => {
    const allowlist = new Set(GOLDEN_SET_SUBMISSION_ALLOWLIST);
    const pseudonymized = new Set(GOLDEN_SET_SUBMISSION_PSEUDONYMIZED_COLUMNS);
    const excluded = new Set(GOLDEN_SET_SUBMISSION_EXCLUDED_COLUMNS);

    for (const name of allowlist) {
      expect(
        pseudonymized.has(name),
        `"${name}" is in both the allowlist and the pseudonymized set`,
      ).toBe(false);
      expect(excluded.has(name), `"${name}" is in both the allowlist and the excluded set`).toBe(
        false,
      );
    }
    for (const name of pseudonymized) {
      expect(excluded.has(name), `"${name}" is in both the pseudonymized and excluded sets`).toBe(
        false,
      );
    }
  });

  it("labeler is pseudonymized, not allowlisted as-is or silently excluded", () => {
    expect(GOLDEN_SET_SUBMISSION_ALLOWLIST).not.toContain("labeler");
    expect(GOLDEN_SET_SUBMISSION_PSEUDONYMIZED_COLUMNS).toContain("labeler");
  });

  it("id, created_at, and submitted_at are excluded — none leave, not even created_at coarsened", () => {
    expect(GOLDEN_SET_SUBMISSION_EXCLUDED_COLUMNS).toEqual(
      expect.arrayContaining(["id", "created_at", "submitted_at"]),
    );
    expect(GOLDEN_SET_SUBMISSION_ALLOWLIST).not.toContain("created_at");
    expect(GOLDEN_SET_SUBMISSION_PSEUDONYMIZED_COLUMNS).not.toContain("created_at");
  });
});

describe('the rendered "It contains exactly:" list is bound to GOLDEN_SET_SUBMISSION_ALLOWLIST (review round 2, finding 3)', () => {
  // Finding 3, demonstrated by the reviewer: the exhaustiveness tests above
  // only prove every real golden_set column is *categorized* somewhere.
  // They said nothing about whether the allowlist actually matches what
  // /data-promise's prose claims leaves the instance — the reviewer added
  // a `reviewer_note` column, listed it in GOLDEN_SET_SUBMISSION_ALLOWLIST,
  // and every test above (and the full 182-test suite) stayed green with
  // the page's "It contains exactly:" list never mentioning it. This test
  // reads the live rendered markdown, pulls the backtick-quoted column
  // identifiers out of that exact bullet list, and asserts the two are
  // identical, in order — so a column added to the allowlist without a
  // matching bullet (or a bullet edited without a matching allowlist
  // entry) fails here instead of riding along silently.
  //
  // The pseudonym bullet (`labeler`) is deliberately excluded: it names a
  // column whose real value is substituted away, not one whose value is
  // copied into the payload as-is, so it is not a member of
  // GOLDEN_SET_SUBMISSION_ALLOWLIST and would break a naive backtick scrape
  // that didn't account for it. Detecting it by the word "pseudonym"
  // rather than by name keeps this test from silently passing if `labeler`
  // ever got copied into the allowlist by mistake — that line always
  // mentions "pseudonym", the allowlist line beside it never does.
  it('extracts the exact backtick-quoted field list from data-promise.ts\'s "It contains exactly:" bullets', () => {
    const markdown = getLegalDocument("data-promise")?.markdown(DEFAULT_LEGAL_CONTEXT) ?? "";
    const lines = markdown.split("\n");

    const introIndex = lines.findIndex((line) => line.includes("It contains exactly:"));
    expect(
      introIndex,
      'could not find the "It contains exactly:" intro line in data-promise.ts',
    ).toBeGreaterThan(-1);

    const listLines: string[] = [];
    for (let i = introIndex + 1; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (line.startsWith("- ")) {
        listLines.push(line);
        continue;
      }
      if (line.trim() === "" && listLines.length === 0) {
        continue;
      }
      break;
    }
    expect(
      listLines.length,
      'found no bullet list immediately after "It contains exactly:"',
    ).toBeGreaterThan(0);

    const extractedFields: string[] = [];
    for (const line of listLines) {
      if (/pseudonym/i.test(line)) {
        // The `labeler` substitution bullet — not an allowlist member.
        continue;
      }
      for (const match of line.matchAll(/`([a-zA-Z0-9_]+)`/g)) {
        extractedFields.push(match[1] ?? "");
      }
    }

    expect(
      extractedFields,
      'the fields named in data-promise.ts\'s "It contains exactly:" list no longer match ' +
        "GOLDEN_SET_SUBMISSION_ALLOWLIST in packages/core/src/legal/submission-fields.ts — update " +
        "both together",
    ).toEqual(GOLDEN_SET_SUBMISSION_ALLOWLIST);
  });

  it("the pseudonym bullet still names labeler and is excluded from the allowlist comparison above by content, not by hardcoding", () => {
    const markdown = getLegalDocument("data-promise")?.markdown(DEFAULT_LEGAL_CONTEXT) ?? "";
    const lines = markdown.split("\n");
    const pseudonymLine = lines.find((line) => /pseudonym/i.test(line) && line.startsWith("- "));
    expect(pseudonymLine).toBeDefined();
    expect(pseudonymLine).toContain("`labeler`");
    expect(GOLDEN_SET_SUBMISSION_ALLOWLIST).not.toContain("labeler");
  });
});

describe("the privacy policy's numeric claims match packages/core/src/config.ts", () => {
  it("the quoted backfill window equals BACKFILL_WINDOW_DAYS", () => {
    const markdown = getLegalDocument("privacy")?.markdown(DEFAULT_LEGAL_CONTEXT) ?? "";
    expect(markdown).toContain(`looks back ${BACKFILL_WINDOW_DAYS} days`);
    // wrangler.jsonc agreement is scripts/verify-config-single-source.mjs's
    // job; this assertion is specifically that the *policy prose* was
    // built from the same named constant, not a copy-pasted number.
    expect(BACKFILL_WINDOW_DAYS).toBe(90);
  });

  it("the quoted golden-set contribution default equals GOLDEN_SET_CONTRIBUTION_DEFAULT", () => {
    const markdown = getLegalDocument("data-promise")?.markdown(DEFAULT_LEGAL_CONTEXT) ?? "";
    expect(markdown).toContain(`defaults to \`${GOLDEN_SET_CONTRIBUTION_DEFAULT}\``);
  });
});

describe("the deployed env vars this Worker actually runs with", () => {
  it("DEPLOYMENT_MODE, OPERATOR_NAME, OPERATOR_CONTACT are present", () => {
    expect(env.DEPLOYMENT_MODE).toBeDefined();
    expect(env.OPERATOR_NAME).toBeDefined();
    expect(env.OPERATOR_CONTACT).toBeDefined();
  });

  it("this checkout's default DEPLOYMENT_MODE is self-hosted", () => {
    // The open artifact must ship self-hosted by default — a fresh
    // checkout is not a hosted fleet instance until a human sets this.
    expect(env.DEPLOYMENT_MODE).toBe("self-hosted");
  });
});
