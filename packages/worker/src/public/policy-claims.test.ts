import { env } from "cloudflare:test";
import {
  BACKFILL_WINDOW_DAYS,
  DEFAULT_LEGAL_CONTEXT,
  GOLDEN_SET_CONTRIBUTION_DEFAULT,
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

  it("labeler is NOT NULL — kept at write time, not nulled (pseudonymized only at export)", async () => {
    const { results } = await env.DB.prepare("PRAGMA table_info(golden_set)").all<{
      name: string;
      notnull: number;
    }>();
    const labeler = results.find((row) => row.name === "labeler");
    expect(labeler?.notnull).toBe(1);
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
