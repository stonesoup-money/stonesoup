import { describe, expect, it } from "vitest";

/**
 * A plain `.test.ts` file (not `.test.tsx`) — proof the `web` Vitest
 * project's `include` actually collects it. Before review round 1,
 * finding 7, that project's `include` matched only `**\/*.test.tsx`; a
 * non-component test in this package (a hook, a formatter, the web-side
 * wiring of the client anonymization filter) matched nothing in *any*
 * project. Vitest only exits 1 when zero files match overall, so
 * App.test.tsx existing kept CI green while this kind of file was
 * silently never run.
 *
 * The assertion below is real, not a no-op: it checks this file executed
 * under happy-dom (the `web` project's environment) — if it were
 * collected by the wrong project, or not collected at all, this would
 * fail or simply vanish rather than pass.
 */
describe("the web Vitest project collects plain .test.ts files", () => {
  it("runs under the happy-dom environment", () => {
    expect(typeof document).toBe("object");
    expect(document.createElement("div").tagName).toBe("DIV");
  });
});
