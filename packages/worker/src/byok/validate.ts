import Anthropic from "@anthropic-ai/sdk";

/**
 * BYOK key validation, layered because each stage catches a different
 * failure (STON-3 plan):
 *
 * 1. Format precheck, no network — catches an unset or mispasted secret
 *    instantly instead of surfacing an opaque 401.
 * 2. `client.models.retrieve(env.ANTHROPIC_MODEL)` — free (zero tokens).
 *    Proves the key authenticates *and* that the configured model string is
 *    real and accessible to that key. A format check alone cannot catch a
 *    typo in ANTHROPIC_MODEL, and the brief refuses to pin the model, so
 *    that typo is a live failure mode.
 * 3. A one-token `messages.create` call — the only stage that proves the
 *    deployment can actually extract (stage 2 returns 200 even for a valid
 *    key on an org with no credit). Opt-in via `runTestMessage`: run once at
 *    onboarding only, never on a routine health poll.
 *
 * The Anthropic client sits behind this module as the seam STON-5 builds
 * its extraction client against; tests here stub `fetch`, so this makes no
 * live network calls in CI.
 */

const KEY_PREFIX = "sk-ant-";

export type ByokStage = "format" | "auth" | "model" | "message" | "ok";

export interface ByokStatus {
  ok: boolean;
  stage: ByokStage;
  model?: string;
  message: string;
}

export interface ByokEnv {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL: string;
}

export interface ValidateAnthropicKeyOptions {
  /** Run the one-token live message call (stage 3). Onboarding only. */
  runTestMessage?: boolean;
}

export async function validateAnthropicKey(
  env: ByokEnv,
  options: ValidateAnthropicKeyOptions = {},
): Promise<ByokStatus> {
  const key = env.ANTHROPIC_API_KEY;

  if (!key?.startsWith(KEY_PREFIX)) {
    return {
      ok: false,
      stage: "format",
      message: "ANTHROPIC_API_KEY is missing or malformed (expected a key starting with sk-ant-).",
    };
  }

  const client = new Anthropic({ apiKey: key });

  let model: Anthropic.ModelInfo;
  try {
    model = await client.models.retrieve(env.ANTHROPIC_MODEL);
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return { ok: false, stage: "auth", message: "ANTHROPIC_API_KEY was rejected by Anthropic." };
    }
    if (error instanceof Anthropic.NotFoundError) {
      return {
        ok: false,
        stage: "model",
        model: env.ANTHROPIC_MODEL,
        message: `ANTHROPIC_MODEL "${env.ANTHROPIC_MODEL}" is not a valid or accessible model for this key.`,
      };
    }
    throw error;
  }

  if (!options.runTestMessage) {
    return { ok: true, stage: "ok", model: model.id, message: "Key and model verified." };
  }

  try {
    await client.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 16,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: "ping" }],
    });
  } catch {
    return {
      ok: false,
      stage: "message",
      model: model.id,
      message: "Key and model are valid, but a live extraction call failed.",
    };
  }

  return {
    ok: true,
    stage: "message",
    model: model.id,
    message: "Key validated with a live extraction call.",
  };
}
