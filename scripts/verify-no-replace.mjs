#!/usr/bin/env node
// AGENTS.md: never `INSERT OR REPLACE` / `REPLACE INTO`. Review round 2,
// finding 1 proved that the migration cannot stop this by itself — the
// `ON DELETE RESTRICT` foreign keys in `migrations/0001_initial_schema.sql`
// defend `receipts`, `sources`, and (as of the round 3 polish pass)
// `line_items` via `review_queue`, but only when the specific row being
// replaced has something referencing it; a childless row of any of those,
// and `golden_set` unconditionally, have no DB-level guard at all: REPLACE
// is DELETE+INSERT, no FK protects a row from being replaced under its own
// primary key when nothing references it, and no trigger can tell
// REPLACE's delete apart from a real one. This script is the only thing
// that stops it in those cases, and it is what catches the real failure
// mode — an agent writing an upsert against `sources` for Gmail reconnect
// (STON-4/STON-6), say — at author time, deterministically, before it ever
// reaches a database.
//
// Matches the literal SQL phrases `INSERT OR REPLACE` and `REPLACE INTO`,
// case-insensitively and word-bounded — not the bare word "replace", which
// appears throughout the codebase in ordinary prose and in
// `String.prototype.replace(...)` calls and must not trip this gate.
// Matched against each file's *whole text*, not line-by-line (round 3
// polish pass, finding 4): splitting on "\n" first, then testing each
// line, lets `INSERT\nOR\nREPLACE\nINTO` escape entirely, because the
// phrase is torn apart across lines before the regex (whose `\s+` would
// otherwise happily match a real newline) ever sees it as one string. The
// match index is mapped back to a line number afterwards so the error
// message stays as useful as a per-line scan's.
//
// AGENTS.md rule #8 bans the statement "anywhere, on any table" — not just
// application code — so this scans `packages/**` (app code), `scripts/**`
// and root `test/**` (build/test tooling that talks to D1 directly), and
// `migrations/**` (a later data-backfill migration writing a literal
// `INSERT OR REPLACE` is the most plausible remaining vector, and nothing
// else catches it there). `.sql` files get their `--` line comments
// blanked out before matching: this migration's own header extensively
// *discusses* the banned phrase in prose as part of documenting why it's
// banned, which is not itself a violation — only a live, uncommented SQL
// statement is.
//
// Skips `*.test.ts` / `*.test.tsx`: `packages/worker/src/schema.test.ts`
// must literally issue `INSERT OR REPLACE INTO ...` to prove the database
// (or this script) rejects/lacks a guard for it, and that is not the
// violation this gate exists to catch — application code is. Also skips
// this script's own file: its comments and error messages necessarily name
// the banned phrase in prose, with real spaces, in order to document and
// report on it — doing that is this gate's job, not a violation of it.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BANNED_RE = /\b(INSERT\s+OR\s+REPLACE|REPLACE\s+INTO)\b/gi;
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".js", ".sql"]);
const TEST_FILE_RE = /\.test\.tsx?$/;
const SKIP_DIRS = new Set(["node_modules", "dist", ".wrangler", "coverage"]);
// The CLI's default scan roots (AGENTS.md rule #8 / invariant #23 — "on any
// table", "anywhere", not just packages/**). A single explicit root may be
// passed instead as argv[2]; see main() below.
const DEFAULT_ROOTS = ["packages", "scripts", "migrations", "test"];
const SELF_PATH = resolve(fileURLToPath(import.meta.url));

function extOf(name) {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i);
}

// SQL's only comment syntax this repo uses is `--` to end of line. Blank
// each comment out (replaced with spaces of the same length) rather than
// removing it, so line numbers computed from character offsets afterward
// stay correct, and so a real, uncommented `INSERT OR REPLACE` elsewhere
// in the same file is still matched at its true position.
function blankSqlComments(text) {
  return text.replace(/--[^\n]*/g, (m) => " ".repeat(m.length));
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

function lineTextAt(text, index) {
  const start = text.lastIndexOf("\n", index - 1) + 1;
  const end = text.indexOf("\n", index);
  return text.slice(start, end === -1 ? text.length : end).trim();
}

function scanFile(full, ext, cwd, hits) {
  const raw = readFileSync(full, "utf8");
  const text = ext === ".sql" ? blankSqlComments(raw) : raw;

  const re = new RegExp(BANNED_RE.source, BANNED_RE.flags);
  let match = re.exec(text);
  while (match !== null) {
    const lineNo = lineNumberAt(text, match.index);
    hits.push(`${relative(cwd, full)}:${lineNo}: ${lineTextAt(text, match.index)}`);
    match = re.exec(text);
  }
}

function walk(dir, hits, cwd) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, hits, cwd);
      continue;
    }
    const ext = extOf(entry);
    if (!SCAN_EXTENSIONS.has(ext) || TEST_FILE_RE.test(entry)) continue;
    if (resolve(full) === SELF_PATH) continue;
    scanFile(full, ext, cwd, hits);
  }
}

// Runs as a CLI against the repo's default roots; a single test target
// directory may be passed as argv[2] instead (used by
// packages/web/src/verify-no-replace-gate.test.ts to exercise this gate
// against fixtures without touching the real repo tree).
function main() {
  const roots = process.argv[2] ? [process.argv[2]] : DEFAULT_ROOTS;
  const cwd = process.cwd();
  const hits = [];
  for (const root of roots) walk(root, hits, cwd);

  if (hits.length > 0) {
    console.error(
      "`INSERT OR REPLACE` / `REPLACE INTO` is banned (AGENTS.md) — it silently deletes and " +
        "recreates a row, bypassing every BEFORE UPDATE trigger and, for a row with nothing " +
        "referencing it, every FK guard too (review round 2, finding 1). Use `ON CONFLICT (...) " +
        "DO UPDATE SET ...` instead. Violations:\n" +
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
