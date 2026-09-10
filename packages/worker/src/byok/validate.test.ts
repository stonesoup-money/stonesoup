import { afterEach, describe, expect, it, vi } from "vitest";
import { validateAnthropicKey } from "./validate.js";

const MODEL = "claude-opus-5";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("validateAnthropicKey", () => {
  it("fails at the format stage with no network call when the key is empty", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const status = await validateAnthropicKey({ ANTHROPIC_API_KEY: "", ANTHROPIC_MODEL: MODEL });

    expect(status).toMatchObject({ ok: false, stage: "format" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails at the format stage with no network call when the key is malformed", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const status = await validateAnthropicKey({
      ANTHROPIC_API_KEY: "not-a-key",
      ANTHROPIC_MODEL: MODEL,
    });

    expect(status).toMatchObject({ ok: false, stage: "format" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports the auth stage on a 401 from Anthropic", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(401, {
          type: "error",
          error: { type: "authentication_error", message: "invalid x-api-key" },
        }),
      ),
    );

    const status = await validateAnthropicKey({
      ANTHROPIC_API_KEY: "sk-ant-bad",
      ANTHROPIC_MODEL: MODEL,
    });

    expect(status).toMatchObject({ ok: false, stage: "auth" });
  });

  it("reports the model stage and names ANTHROPIC_MODEL on a 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(404, {
          type: "error",
          error: { type: "not_found_error", message: "model not found" },
        }),
      ),
    );

    const status = await validateAnthropicKey({
      ANTHROPIC_API_KEY: "sk-ant-good",
      ANTHROPIC_MODEL: "bogus-model",
    });

    expect(status).toMatchObject({ ok: false, stage: "model", model: "bogus-model" });
    expect(status.message).toContain("bogus-model");
  });

  it("reports ok on a 200 without running the test message by default", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, {
        id: MODEL,
        type: "model",
        display_name: "Claude Opus 5",
        created_at: "2026-01-01T00:00:00Z",
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const status = await validateAnthropicKey({
      ANTHROPIC_API_KEY: "sk-ant-good",
      ANTHROPIC_MODEL: MODEL,
    });

    expect(status).toMatchObject({ ok: true, stage: "ok", model: MODEL });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("runs the one-token test message only when explicitly requested", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/models/")) {
        return jsonResponse(200, {
          id: MODEL,
          type: "model",
          display_name: "Claude Opus 5",
          created_at: "2026-01-01T00:00:00Z",
        });
      }
      if (url.includes("/v1/messages")) {
        return jsonResponse(200, {
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: MODEL,
          content: [{ type: "text", text: "pong" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const status = await validateAnthropicKey(
      { ANTHROPIC_API_KEY: "sk-ant-good", ANTHROPIC_MODEL: MODEL },
      { runTestMessage: true },
    );

    expect(status).toMatchObject({ ok: true, stage: "message", model: MODEL });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
