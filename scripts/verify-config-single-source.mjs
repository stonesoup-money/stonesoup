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
];

let failed = false;
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
