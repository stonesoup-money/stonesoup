#!/usr/bin/env node
// AGENTS.md, Design language: "all design values go through CSS custom
// properties / the Tailwind v4 theme. No inline hex, no named colors, no
// pixel literals in a component" — and `packages/web/public/tokens.css`
// is the one file allowed to declare the six-hex palette (STON-13).
// packages/web/public/** is outside the scanned roots below by
// construction (not packages/web/src/**), so tokens.css needs no
// exception carved out for it.
//
// Mechanical, not semantic (STON-2's plan, §4): this checks for a fact a
// machine can verify — does this text contain a hex literal, an rgb()/
// rgba() call, or a bare CSS named-color value — not whether a design
// "is right". `transparent` is excluded from the named-color list: it
// carries no RGB value of its own and is legitimate inside a
// `color-mix(...)` built entirely from tokens (see dialog.css).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["packages/web/src", "packages/worker/src"];
const SCAN_EXTENSIONS = new Set([".css", ".ts", ".tsx"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage"]);
// Test files legitimately carry synthetic data that happens to look like a
// hex literal — a printed store number ("TRADER JOE'S #123") is valid hex
// digits by coincidence — and this gate's job is application/component
// code, not test fixtures. Same exclusion shape as
// scripts/verify-no-replace.mjs's TEST_FILE_RE.
const TEST_FILE_RE = /\.test\.tsx?$/;

const HEX_RE = /#[0-9a-fA-F]{3}\b|#[0-9a-fA-F]{4}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{8}\b/g;
const RGB_FUNC_RE = /\brgba?\(/gi;

// A representative set of CSS named colors, not the exhaustive ~150 —
// wide enough to catch a real regression, deliberately excluding
// `transparent` (see module comment) and `currentColor` (not a color
// value at all — it's "whatever `color` already resolved to").
const NAMED_COLORS = new Set([
  "black",
  "white",
  "red",
  "green",
  "blue",
  "yellow",
  "orange",
  "purple",
  "pink",
  "brown",
  "cyan",
  "magenta",
  "lime",
  "navy",
  "teal",
  "maroon",
  "olive",
  "silver",
  "gold",
  "indigo",
  "violet",
  "coral",
  "salmon",
  "khaki",
  "orchid",
  "plum",
  "tan",
  "beige",
  "ivory",
  "lavender",
  "crimson",
  "turquoise",
  "gray",
  "grey",
  "chocolate",
  "chartreuse",
]);

// Matches a CSS declaration whose value is a single bare named-color
// token — `color: red;`, `border-color: navy,` — not `var(...)`, not a
// hyphenated identifier (`--color-red` itself, or `thermal-grey` inside a
// custom-property name) sharing a substring with a color word.
const NAMED_COLOR_DECL_RE = /:\s*([a-zA-Z]+)\s*[;,)]/g;

function extOf(name) {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i);
}

// Blanks /* ... */ comments (replaced with spaces of the same length, so
// offsets stay meaningful) before scanning a CSS file — this file's own
// header comments document the banned patterns in prose and must not trip
// the gate they describe, the same reasoning
// scripts/verify-no-replace.mjs's blankSqlComments applies to `--` comments.
function blankCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length));
}

function scanFile(full, cwd, hits) {
  const raw = readFileSync(full, "utf8");
  const ext = extOf(full);
  const text = ext === ".css" ? blankCssComments(raw) : raw;

  for (const re of [HEX_RE, RGB_FUNC_RE]) {
    const r = new RegExp(re.source, re.flags);
    let m = r.exec(text);
    while (m !== null) {
      hits.push(`${relative(cwd, full)}: found "${m[0]}" — use a token from tokens.css instead`);
      m = r.exec(text);
    }
  }

  if (ext === ".css") {
    const r = new RegExp(NAMED_COLOR_DECL_RE.source, NAMED_COLOR_DECL_RE.flags);
    let m = r.exec(text);
    while (m !== null) {
      const candidate = (m[1] ?? "").toLowerCase();
      if (NAMED_COLORS.has(candidate)) {
        hits.push(
          `${relative(cwd, full)}: found named color "${candidate}" — use a token from tokens.css instead`,
        );
      }
      m = r.exec(text);
    }
  }
}

function walk(dir, cwd, hits) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, cwd, hits);
      continue;
    }
    if (!SCAN_EXTENSIONS.has(extOf(entry)) || TEST_FILE_RE.test(entry)) continue;
    scanFile(full, cwd, hits);
  }
}

function main() {
  const cwd = process.cwd();
  const hits = [];
  for (const root of ROOTS) walk(root, cwd, hits);

  if (hits.length > 0) {
    console.error(
      "Design tokens gate failed (AGENTS.md, Design language) — every color must come from " +
        "packages/web/public/tokens.css, referenced via var(--...), not restated:\n" +
        hits.map((h) => `  ${h}`).join("\n"),
    );
    process.exit(1);
  }

  console.log(
    "No raw hex/rgb()/named-color literal found under packages/web/src or packages/worker/src.",
  );
}

main();
