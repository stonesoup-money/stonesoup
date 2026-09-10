import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Two projects, not one: the Workers integration's custom test environment
// cannot share a project with happy-dom (unsupported combination), and the
// two halves have mutually exclusive type environments (workers-types vs
// DOM) and build tools (wrangler/esbuild vs Vite) anyway.
const workerMigrations = await readD1Migrations("./migrations");

export default defineConfig({
  test: {
    projects: [
      {
        // `worker` also runs packages/core's tests: exercising `core`
        // inside the real Workers runtime is free and enforces the "core
        // has no Node-only dependencies" invariant tsconfig otherwise only
        // checks at the type level.
        test: {
          name: "worker",
          include: ["packages/worker/**/*.test.ts", "packages/core/**/*.test.ts"],
          setupFiles: ["./test/apply-migrations.ts"],
        },
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            // The AI binding has no local emulation and otherwise makes
            // Miniflare eagerly try to authenticate against a Cloudflare
            // account at startup, even though no test on this path calls
            // env.AI (see wrangler.jsonc). CI has no such account, so this
            // must be off, not merely unused-in-tests.
            remoteBindings: false,
            miniflare: {
              bindings: {
                TEST_MIGRATIONS: workerMigrations,
                // Round 2, finding 1 (Review invariant 6): `queue()` in
                // packages/worker/src/index.ts always built a real
                // Anthropic client from `env.ANTHROPIC_API_KEY`, and the
                // Workers Vitest pool loads that key from a contributor's
                // own `.dev.vars` — so any test that reaches `queue()`
                // could fire a live vision call on a contributor's own
                // key. This binding is the positive test-mode signal
                // `index.ts` checks before resolving its extraction
                // client — never present in `wrangler.jsonc` or
                // `.dev.vars`, so the swap to a fixture client is
                // structural, not a guess from an absent key.
                EXTRACTION_TEST_FIXTURE_CLIENT: "1",
              },
              // Round 2, finding 4: `upload.test.ts`'s `POST
              // /api/receipts` calls enqueue onto `EXTRACTION_QUEUE`, and
              // Miniflare's local queue simulator auto-delivers those
              // messages to the real `queue()` consumer in the same
              // instance — racing the test's own follow-up status reads
              // and making `expect(status).toBe("pending")` ~10% flaky.
              // Redirecting this project's `EXTRACTION_QUEUE` producer to
              // a queue name with no consumer anywhere in
              // `wrangler.jsonc` makes every worker test's `.send()` land
              // nowhere, deterministically, instead of racing on timing.
              // `consumer.test.ts` is unaffected — it calls
              // `processExtractionJob` directly, never through this
              // producer binding.
              queueProducers: {
                EXTRACTION_QUEUE: { queueName: "stonesoup-extraction-test-unconsumed" },
              },
            },
          }),
        ],
      },
      {
        test: {
          name: "web",
          environment: "happy-dom",
          include: ["packages/web/**/*.test.{ts,tsx}"],
          setupFiles: ["./test/setup-web.ts"],
        },
        plugins: [react()],
      },
    ],
  },
});
