import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Review round 2, findings 1 and 5: `line_items` and `golden_set` have no
 * DB-level guard against `INSERT OR REPLACE` — no FK to restrict, and no
 * trigger can tell REPLACE's delete apart from a real one (see the
 * migration header and packages/worker/src/schema.test.ts's
 * "no DB-level guard" describe block, which proves the database side of
 * this honestly). `scripts/verify-no-replace.mjs`, wired into `pnpm check`,
 * is the *only* thing that stops the statement for those two tables, so it
 * is tested directly here by spawning it as a real process against
 * throwaway fixture files — not by importing it, and not by touching D1 at
 * all. This is deliberate: round 1's REPLACE-guard tests passed only
 * because the Vitest harness's migration runner and the test suite shared
 * one Miniflare connection, and this file's whole job is to prove its own
 * mechanism does not repeat that trap — there is no D1 binding, no
 * migration runner, and no shared connection anywhere in this file for a
 * false pass to hide behind.
 *
 * This lives in packages/web, not packages/worker or packages/core,
 * because those two run inside the `worker` Vitest project's Workers
 * sandbox (`@cloudflare/vitest-plugin`), which has no `node:child_process`
 * — the `web` project runs happy-dom in a real Node process and is the
 * only place in this repo that can spawn `scripts/verify-no-replace.mjs`
 * as a process the way `pnpm check` itself does.
 */
// `import.meta.url` is not a real `file://` URL once Vite/Vitest has
// transformed this module, so it cannot be used to locate the script.
// Vitest (like every other script in this repo) always runs with the repo
// root as `process.cwd()` — see e.g. scripts/verify-config-single-source.mjs
// reading "packages/core/src/config.ts" the same way.
const SCRIPT_PATH = join(process.cwd(), "scripts", "verify-no-replace.mjs");

function runGate(fixtures: Record<string, string>): { status: number; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "no-replace-gate-"));
  try {
    for (const [name, contents] of Object.entries(fixtures)) {
      writeFileSync(join(dir, name), contents);
    }
    execFileSync("node", [SCRIPT_PATH, dir], { stdio: "pipe" });
    return { status: 0, stderr: "" };
  } catch (error) {
    const e = error as { status: number | null; stderr: Buffer };
    return { status: e.status ?? 1, stderr: e.stderr.toString() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("the INSERT OR REPLACE grep gate (review round 2, findings 1 and 5)", () => {
  it("fails on INSERT OR REPLACE INTO line_items in application code", () => {
    const result = runGate({
      "repo.ts": [
        "export async function upsertLineItem(db: D1Database, id: string) {",
        "  await db",
        "    .prepare(`INSERT OR REPLACE INTO line_items (id) VALUES (?)`)",
        "    .bind(id)",
        "    .run();",
        "}",
      ].join("\n"),
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/INSERT OR REPLACE/i);
    expect(result.stderr).toMatch(/repo\.ts:3/);
  });

  it("fails on REPLACE INTO golden_set in application code", () => {
    const result = runGate({
      "repo.ts": "const sql = `REPLACE INTO golden_set (id) VALUES (?)`;",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/REPLACE INTO/i);
  });

  it("fails on a .tsx file too, not just .ts", () => {
    const result = runGate({
      "Component.tsx": 'const sql = "INSERT OR REPLACE INTO sources (id) VALUES (?)";',
    });
    expect(result.status).not.toBe(0);
  });

  it("does not false-positive on the bare word 'replace' in prose or String.prototype.replace", () => {
    const result = runGate({
      "prose.ts": [
        "// ISO 8601 is the convention that replaces SQLite's lack of a date type.",
        "export function slugify(value: string): string {",
        '  return value.replace(/\\s+/g, "-").toLowerCase();',
        "}",
      ].join("\n"),
    });
    expect(result.status).toBe(0);
  });

  it("ignores *.test.ts and *.test.tsx fixtures, which must literally contain the banned statement to prove rejection/absence of one", () => {
    const result = runGate({
      "schema.test.ts": "const sql = `INSERT OR REPLACE INTO line_items (id) VALUES (?)`;",
      "component.test.tsx": "const sql = `REPLACE INTO golden_set (id) VALUES (?)`;",
    });
    expect(result.status).toBe(0);
  });

  it("passes on a clean ON CONFLICT DO UPDATE upsert", () => {
    const result = runGate({
      "repo.ts": [
        "const sql = `INSERT INTO line_items (id, normalized_name) VALUES (?, ?)",
        "  ON CONFLICT(id) DO UPDATE SET normalized_name = excluded.normalized_name`;",
      ].join("\n"),
    });
    expect(result.status).toBe(0);
  });

  it("passes on an empty fixture directory", () => {
    const result = runGate({});
    expect(result.status).toBe(0);
  });
});
