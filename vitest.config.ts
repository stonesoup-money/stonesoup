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
              bindings: { TEST_MIGRATIONS: workerMigrations },
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
