#!/usr/bin/env node
// wrangler.jsonc can't import TypeScript, so packages/core/src/config.ts
// (the single named source for every tunable — AGENTS.md, "Config values,
// not hardcodes") and wrangler.jsonc's `vars` block are two separate texts
// that can silently drift with no compiler in between to catch it (review
// round 1, finding 13). This script is that catch.
//
// Values are compared as source *text*, not evaluated: config.ts's
// `SAMPLING_RATE_DEFAULT = 1.0` must read back as the text "1.0" to match
// wrangler.jsonc's quoted `"1.0"` — evaluating `1.0` as a JS number and
// re-stringifying it would give "1", a false mismatch.
import { readFileSync } from "node:fs";

const configSrc = readFileSync("packages/core/src/config.ts", "utf8");
const wranglerSrc = readFileSync("wrangler.jsonc", "utf8");

function coreValue(name) {
  const match = configSrc.match(new RegExp(`export const ${name}\\s*=\\s*([^;]+);`));
  if (!match) {
    throw new Error(`packages/core/src/config.ts: could not find "export const ${name}"`);
  }
  return match[1].trim().replace(/^"(.*)"$/, "$1");
}

// wrangler.jsonc is JSONC (`//` comments) — every comment in this file is
// a standalone line, so stripping lines that start with `//` is enough
// and avoids pulling in a JSONC parser dependency for one script.
const wranglerJson = JSON.parse(wranglerSrc.replace(/^\s*\/\/.*$/gm, ""));
const wranglerVars = wranglerJson.vars ?? {};

// wrangler.jsonc var name -> packages/core/src/config.ts export name.
const PAIRS = [
  ["ANTHROPIC_MODEL", "DEFAULT_EXTRACTION_MODEL"],
  ["TAXONOMY_VERSION", "TAXONOMY_VERSION"],
  ["BACKFILL_WINDOW_DAYS", "BACKFILL_WINDOW_DAYS"],
  ["SAMPLING_RATE", "SAMPLING_RATE_DEFAULT"],
  ["CONFIDENCE_FLOOR", "CONFIDENCE_FLOOR_DEFAULT"],
  ["DAILY_REVIEW_CAP", "DAILY_REVIEW_CAP_DEFAULT"],
  ["REVIEW_QUEUE_CAP", "REVIEW_QUEUE_CAP"],
  ["REVIEW_QUEUE_REFILL_AT", "REVIEW_QUEUE_REFILL_AT"],
  ["GOLDEN_SET_CONTRIBUTION", "GOLDEN_SET_CONTRIBUTION_DEFAULT"],
  // STON-13 public pages.
  ["DEPLOYMENT_MODE", "DEPLOYMENT_MODE_DEFAULT"],
  ["OPERATOR_NAME", "OPERATOR_NAME_DEFAULT"],
  ["OPERATOR_CONTACT", "OPERATOR_CONTACT_DEFAULT"],
];

// config.ts exports that are deliberately *not* a wrangler.jsonc var — pure
// constants with no env-tunable lever (AGENTS.md: "config values, not
// hardcodes" means a single named export, not that every export must be an
// env var). Anything exported from config.ts that is neither here nor in
// PAIRS is an unpaired export this script cannot see, which is exactly
// review round 2, finding 6's complaint — so it fails instead of passing
// silently.
const CORE_ONLY_EXPORTS = new Set([
  "CHECKSUM_TOLERANCE_MIN_CENTS",
  "CHECKSUM_TOLERANCE_PERCENT",
  "DEDUPE_DATE_WINDOW_DAYS",
]);

let failed = false;

// Every wrangler.jsonc var must be paired. Review round 2, finding 6:
// wrangler.jsonc shipped GOLDEN_SET_CONTRIBUTION with no config.ts export
// and no entry in PAIRS, and this script had no way to notice — a
// hand-maintained PAIRS list is invisible to a var added on only one side.
for (const wranglerName of Object.keys(wranglerVars)) {
  if (!PAIRS.some(([w]) => w === wranglerName)) {
    console.error(
      `wrangler.jsonc vars.${wranglerName} has no packages/core/src/config.ts pair — add one and ` +
        "a matching entry to PAIRS in scripts/verify-config-single-source.mjs (review round 2, finding 6).",
    );
    failed = true;
  }
}

// Every config.ts export that looks like a tunable must be accounted for
// too — either paired or explicitly listed as intentionally unpaired.
// The type annotation is optional and, when present, skipped up to the `=`
// (round 3 polish pass, finding 6): the old pattern required `=`
// immediately after the name, so `export const NOVELTY_THRESHOLD: number
// = 0.3;` was invisible to this loop entirely — neither paired nor
// flagged as unpaired, reopening review round 2, finding 6 for exactly
// the export shape it was meant to catch.
const exportNames = [...configSrc.matchAll(/export const ([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=/g)].map(
  (m) => m[1],
);
for (const name of exportNames) {
  if (PAIRS.some(([, c]) => c === name) || CORE_ONLY_EXPORTS.has(name)) continue;
  console.error(
    `packages/core/src/config.ts exports ${name} but it is neither paired with a wrangler.jsonc ` +
      "var (PAIRS) nor listed in CORE_ONLY_EXPORTS as intentionally unpaired, in " +
      "scripts/verify-config-single-source.mjs (review round 2, finding 6).",
  );
  failed = true;
}

for (const [wranglerName, coreName] of PAIRS) {
  const wranglerValue = wranglerVars[wranglerName];
  if (wranglerValue === undefined) {
    console.error(`wrangler.jsonc vars.${wranglerName} is missing`);
    failed = true;
    continue;
  }
  const coreVal = coreValue(coreName);
  if (String(wranglerValue) !== coreVal) {
    console.error(
      `config drift: wrangler.jsonc vars.${wranglerName} = ${JSON.stringify(wranglerValue)} but ` +
        `packages/core/src/config.ts ${coreName} = ${coreVal}`,
    );
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log("wrangler.jsonc vars match packages/core/src/config.ts.");
