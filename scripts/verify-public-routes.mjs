#!/usr/bin/env node
// STON-13: the Workers Vitest pool may not faithfully simulate
// `wrangler.jsonc`'s `assets.run_worker_first` — a passing SELF.fetch
// test suite would prove the Hono route exists but not that a real
// deployment ever reaches it. `not_found_handling:
// "single-page-application"` makes ANY path not listed in
// `run_worker_first` silently resolve to the SPA's index.html instead —
// a page that renders perfectly and is shadowed by the SPA still fails
// Google's consent-screen check, silently, with no error anywhere. This
// script is the static, deterministic check that closes that gap: it
// reads the two texts as source, not by running the Worker, and fails if
// they ever disagree.
//
// Checked both directions:
//   1. every path in packages/core/src/legal/documents.ts (the single
//      registry the Hono route table itself reads) has an exact entry in
//      wrangler.jsonc's run_worker_first array;
//   2. every one of those wrangler.jsonc entries that looks like one of
//      the three legal-document paths is one this script recognizes,
//      so a typo'd or orphaned entry does not pass silently either.
import { readFileSync } from "node:fs";

const documentsSrc = readFileSync("packages/core/src/legal/documents.ts", "utf8");
const wranglerSrc = readFileSync("wrangler.jsonc", "utf8");
const pagesSrc = readFileSync("packages/worker/src/public/pages.ts", "utf8");

// Pull each `path: "/foo"` entry out of the LEGAL_DOCUMENTS array —
// matched as source text, deliberately not `import()`ed, so this script
// has no TypeScript/ESM toolchain dependency and runs as plain Node
// (same idiom as verify-config-single-source.mjs).
const pathMatches = [...documentsSrc.matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1]);

if (pathMatches.length === 0) {
  console.error(
    'scripts/verify-public-routes.mjs: found no `path: "..."` entries in ' +
      "packages/core/src/legal/documents.ts — the LEGAL_DOCUMENTS registry may have moved.",
  );
  process.exit(1);
}

// wrangler.jsonc is JSONC (`//` comments) — every comment in this file is
// a standalone line, so stripping lines that start with `//` is enough
// (same approach as verify-config-single-source.mjs; avoids a JSONC
// parser dependency for one script).
const wranglerJson = JSON.parse(wranglerSrc.replace(/^\s*\/\/.*$/gm, ""));
const runWorkerFirst = wranglerJson.assets?.run_worker_first ?? [];

let failed = false;

for (const path of pathMatches) {
  if (!runWorkerFirst.includes(path)) {
    console.error(
      `wrangler.jsonc's assets.run_worker_first is missing "${path}" — without this exact entry, ` +
        `not_found_handling: "single-page-application" serves the SPA shell at ${path} instead of ` +
        "the Worker-rendered page, and this silently breaks Google's OAuth consent-screen requirement.",
    );
    failed = true;
  }
}

const legalPathPattern = /^\/(privacy|terms|data-promise)$/;
for (const entry of runWorkerFirst) {
  if (legalPathPattern.test(entry) && !pathMatches.includes(entry)) {
    console.error(
      `wrangler.jsonc's assets.run_worker_first lists "${entry}" as a legal-document path, but ` +
        "packages/core/src/legal/documents.ts's LEGAL_DOCUMENTS registry has no matching entry — " +
        "an orphaned or typo'd route.",
    );
    failed = true;
  }
}

// Every registry path must also have a Hono route registered — the
// pages.ts loop (`for (const doc of LEGAL_DOCUMENTS) publicPages.get(doc.path, ...)`)
// is itself a loop over the registry, so this is really checking that the
// loop shape hasn't been replaced by a hand-written subset. Matched as a
// simple substring rather than parsed, deliberately conservative: this
// check exists to catch an accidental narrowing, not to police style.
if (
  !pagesSrc.includes("for (const doc of LEGAL_DOCUMENTS)") ||
  !pagesSrc.includes("publicPages.get(doc.path")
) {
  console.error(
    "packages/worker/src/public/pages.ts no longer registers a Hono route per LEGAL_DOCUMENTS " +
      "entry via a loop over the registry — verify every path in packages/core/src/legal/documents.ts " +
      "still has a real route, then update this check if the shape changed deliberately.",
  );
  failed = true;
}

if (failed) {
  process.exit(1);
}

console.log(
  `All ${pathMatches.length} public legal document path(s) are present in wrangler.jsonc's ` +
    "assets.run_worker_first, and pages.ts registers a route for each.",
);
