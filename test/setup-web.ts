import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";

/**
 * `globals: false` in vitest.config.ts's `web` project means
 * `@testing-library/react`'s automatic post-test DOM cleanup (which only
 * self-registers against a *global* `afterEach`) never fires on its own —
 * every component test would otherwise accumulate every previous test's
 * rendered DOM in the same happy-dom document. Explicit here instead.
 */
afterEach(() => {
  cleanup();
});

/**
 * A component test must never make a real network call (mirrors Review
 * invariant 6's "no test makes a live model call" for the web project) —
 * happy-dom's `fetch` otherwise tries a real connection to a relative
 * URL's resolved localhost origin and fails noisily. Every test starts
 * with `fetch` stubbed to reject; a test that needs a specific response
 * overrides it with `vi.stubGlobal("fetch", vi.fn(...))` of its own,
 * which `afterEach` below un-stubs before the next test re-applies this
 * default.
 */
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("fetch is not mocked in this test"))),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
