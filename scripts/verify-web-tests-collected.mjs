#!/usr/bin/env node
// Review round 2, finding 10:
// packages/web/src/vitest-project-include.test.ts cannot detect its own
// absence. Its whole point (review round 1, finding 7) is proving the
// `web` Vitest project's `include` collects plain `.test.ts` files, not
// only `.test.tsx` — but if that `include` regressed back to
// `**/*.test.tsx` only, this file (and any other non-component test)
// would simply not be collected, and since App.test.tsx still matches,
// `vitest run` would still exit 0. A test that has silently stopped
// running cannot fail.
//
// This script closes that by not trusting vitest's own `include` at all:
// it independently walks the filesystem for every
// `packages/web/**/*.test.{ts,tsx}` file and compares that count against
// how many files the `web` project's own JSON reporter says it actually
// ran. A regressed `include` makes the two counts diverge, and this exits
// non-zero instead of staying green.
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const WEB_ROOT = "packages/web";
const TEST_FILE_RE = /\.test\.tsx?$/;
const SKIP_DIRS = new Set(["node_modules", "dist"]);

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (TEST_FILE_RE.test(entry)) {
      out.push(full);
    }
  }
}

const onDisk = [];
walk(WEB_ROOT, onDisk);
onDisk.sort();

const output = execFileSync(
  "pnpm",
  ["exec", "vitest", "run", "--project", "web", "--reporter=json"],
  { encoding: "utf8" },
);
const report = JSON.parse(output);
const collected = report.testResults.map((r) => r.name).sort();

if (collected.length !== onDisk.length) {
  console.error(
    `The web Vitest project collected ${collected.length} test file(s), but ${onDisk.length} ` +
      "file(s) matching packages/web/**/*.test.{ts,tsx} exist on disk:\n" +
      `  on disk:   ${JSON.stringify(onDisk)}\n` +
      `  collected: ${JSON.stringify(collected)}\n` +
      "vitest.config.ts's `web` project `include` has likely regressed (review round 1, finding 7; " +
      "review round 2, finding 10) — a narrower pattern such as `**/*.test.tsx` would silently drop " +
      "every plain .test.ts file without failing the build.",
  );
  process.exit(1);
}

console.log(`web Vitest project collected all ${collected.length} test file(s) on disk.`);
