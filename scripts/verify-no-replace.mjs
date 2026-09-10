#!/usr/bin/env node
// AGENTS.md: never `INSERT OR REPLACE` / `REPLACE INTO`. Review round 2,
// finding 1 proved that the migration cannot stop this by itself — the
// `ON DELETE RESTRICT` foreign keys in `migrations/0001_initial_schema.sql`
// defend `receipts` and `sources` (anything with children), but
// `line_items` and `golden_set` have no DB-level guard at all: REPLACE is
// DELETE+INSERT, no FK protects a row from being replaced under its own
// primary key, and no trigger can tell REPLACE's delete apart from a real
// one. This script is the only thing that stops it for those two tables,
// and it is what catches the real failure mode — an agent writing an
// upsert against `sources` for Gmail reconnect (STON-4/STON-6), say — at
// author time, deterministically, before it ever reaches a database.
//
// Matches only the literal SQL phrases `INSERT OR REPLACE` and
// `REPLACE INTO`, case-insensitively and word-bounded — not the bare word
// "replace", which appears throughout the codebase in ordinary prose and
// in `String.prototype.replace(...)` calls and must not trip this gate.
//
// Skips `*.test.ts` / `*.test.tsx`: `packages/worker/src/schema.test.ts`
// must literally issue `INSERT OR REPLACE INTO ...` to prove the database
// (or this script) rejects/lacks a guard for it, and that is not the
// violation this gate exists to catch — application code is.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const BANNED_RE = /\b(INSERT\s+OR\s+REPLACE|REPLACE\s+INTO)\b/i;
const SCAN_EXTENSIONS = new Set([".ts", ".tsx"]);
const TEST_FILE_RE = /\.test\.tsx?$/;
const SKIP_DIRS = new Set(["node_modules", "dist", ".wrangler", "coverage"]);

function extOf(name) {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i);
}

function walk(dir, hits, cwd) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, hits, cwd);
      continue;
    }
    if (!SCAN_EXTENSIONS.has(extOf(entry)) || TEST_FILE_RE.test(entry)) continue;
    const text = readFileSync(full, "utf8");
    text.split("\n").forEach((line, i) => {
      if (BANNED_RE.test(line)) {
        hits.push(`${relative(cwd, full)}:${i + 1}: ${line.trim()}`);
      }
    });
  }
}

// Runs as a CLI against `packages/` by default; a test target directory
// may be passed as argv[2] (used by
// packages/web/src/verify-no-replace-gate.test.ts to exercise this gate
// against fixtures without touching the real repo tree).
function main() {
  const root = process.argv[2] ?? "packages";
  const cwd = process.cwd();
  const hits = [];
  walk(root, hits, cwd);

  if (hits.length > 0) {
    console.error(
      "`INSERT OR REPLACE` / `REPLACE INTO` is banned (AGENTS.md) — it silently deletes and " +
        "recreates a row, bypassing every BEFORE UPDATE trigger and, for line_items/golden_set, " +
        "every FK guard too (review round 2, finding 1). Use `ON CONFLICT (...) DO UPDATE SET ...` " +
        "instead. Violations:\n" +
        hits.map((h) => `  ${h}`).join("\n"),
    );
    process.exit(1);
  }

  console.log("No `INSERT OR REPLACE` / `REPLACE INTO` found outside test files.");
}

// Only run as a CLI, not when imported (kept import-safe in case a future
// test wants the matcher directly instead of spawning this as a process).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
