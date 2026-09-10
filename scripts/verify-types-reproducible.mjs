#!/usr/bin/env node
// Verifies `worker-configuration.d.ts` is exactly what `wrangler types`
// produces from this repo alone, with no local `.dev.vars` — a fresh
// clone and CI never have one, so if the committed file only matches
// what a machine with a local `.dev.vars` produces, it silently drifts
// the moment anyone else regenerates it (review round 1, finding 6).
// `packages/worker/src/env.d.ts` is where a binding that only exists as
// a Workers Secret (no `wrangler.jsonc` `vars` entry — BYOK's
// ANTHROPIC_API_KEY) belongs instead; `wrangler types` never touches it.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "worker-configuration.d.ts";
const before = readFileSync(FILE, "utf8");

execSync("pnpm exec wrangler types", { stdio: "pipe" });

const after = readFileSync(FILE, "utf8");

if (before !== after) {
  // Leave the committed content in place — this check must not be the
  // thing that dirties the working tree.
  writeFileSync(FILE, before);
  console.error(
    `${FILE} is not reproducible from a clean checkout: \`wrangler types\` produced a different file ` +
      "when run with no local .dev.vars.\n" +
      "If this is expected (a wrangler.jsonc binding changed), run `pnpm gen:types` and commit the result.\n" +
      "If it's not expected, something only present on this machine (e.g. a local .dev.vars) is leaking " +
      "into what gets committed — see packages/worker/src/env.d.ts for how a secrets-only binding like " +
      "ANTHROPIC_API_KEY should be declared instead.",
  );
  process.exit(1);
}

console.log(`${FILE} is reproducible from a clean checkout.`);
