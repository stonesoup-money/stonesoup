import { applyD1Migrations, env } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-plugin";

// `env.TEST_MIGRATIONS` is injected by vitest.config.ts's `miniflare.bindings`
// — it is not a real deployment binding, so it is not in worker-configuration.d.ts.
const { DB, TEST_MIGRATIONS } = env as typeof env & { TEST_MIGRATIONS: D1Migration[] };

await applyD1Migrations(DB, TEST_MIGRATIONS);
