import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { getSessionUser, PLACEHOLDER_USER_ID, PUBLIC_API_PATHS, withSession } from "./session.js";

function buildApp() {
  const app = new Hono();
  app.use("/api/*", withSession);
  app.get("/api/health", (c) => c.json({ ok: true }));
  app.get("/api/whoami", (c) => c.json(getSessionUser(c)));
  return app;
}

describe("withSession / getSessionUser (STON-2's 'hardcoded auth is fine' seam)", () => {
  it("sets a UUID-shaped placeholder user on a protected route", async () => {
    const app = buildApp();
    const res = await app.request("/api/whoami");
    const body = (await res.json()) as { userId: string; labeler: string };
    expect(body.userId).toBe(PLACEHOLDER_USER_ID);
    expect(body.labeler).toBe(PLACEHOLDER_USER_ID);
    expect(body.userId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("PUBLIC_API_PATHS lists /api/health and that route works with no user set", async () => {
    expect(PUBLIC_API_PATHS).toContain("/api/health");
    const app = buildApp();
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
  });
});
