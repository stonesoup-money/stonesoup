/**
 * "Hardcoded auth is fine" (STON-2's brief) — one module, written so
 * STON-4 replaces its body rather than excavating call sites.
 * `withSession`, `getSessionUser`, and `PUBLIC_API_PATHS` are the surface
 * STON-4's plan is written against and commits to keeping.
 *
 * `PLACEHOLDER_USER_ID` is a UUID-shaped value (STON-4 D5 mints `userId`
 * as a local UUID) because it flows into R2 key paths and
 * `golden_set.labeler` — every real call site reads `c.get("user")`,
 * never this constant directly, so STON-4's excavation is a single-file
 * diff. Not a config.ts export and not a wrangler.jsonc var: this is a
 * value to be deleted, not a tunable to be retuned.
 */

import type { Context, MiddlewareHandler } from "hono";

export const PLACEHOLDER_USER_ID = "00000000-0000-4000-8000-000000000001";

export interface SessionUser {
  userId: string;
  /** The identifier written to `golden_set.labeler` for a verdict this
   * user resolves — kept locally, pseudonymized only at the submission
   * boundary (AGENTS.md, Privacy and the anonymization boundary). */
  labeler: string;
}

/** Paths under `/api/*` that skip session middleware — an explicit
 * allowlist, not Hono registration order, which is too subtle to be a
 * security boundary. */
export const PUBLIC_API_PATHS: readonly string[] = ["/api/health"];

declare module "hono" {
  interface ContextVariableMap {
    user: SessionUser;
  }
}

/** Mounted `app.use("/api/*", withSession)` only — never in front of
 * `/privacy`, `/terms`, `/data-promise` (AGENTS.md, "Public pages and the
 * privacy policy"). */
export const withSession: MiddlewareHandler = async (c, next) => {
  if (PUBLIC_API_PATHS.includes(c.req.path)) {
    return next();
  }
  c.set("user", { userId: PLACEHOLDER_USER_ID, labeler: PLACEHOLDER_USER_ID });
  return next();
};

export function getSessionUser(c: Context): SessionUser {
  return c.get("user");
}
