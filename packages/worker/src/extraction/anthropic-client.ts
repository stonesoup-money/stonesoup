/**
 * The real extraction client — one vision call to Anthropic (AGENTS.md,
 * Pipeline rules: "no third-party OCR services; the vision model does the
 * whole receipt in one call"). Built on the `@anthropic-ai/sdk` seam
 * `packages/worker/src/byok/validate.ts` already established: reuses its
 * `ANTHROPIC_MODEL || DEFAULT_EXTRACTION_MODEL` fallback rather than
 * inventing a second one.
 *
 * No test calls this file — extraction tests use
 * `createFixtureExtractionClient` (`./fixture-client.js`) with JSON
 * fixtures under `fixtures/*.json` (Review invariant 6).
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  buildExtractionSystemPrompt,
  DEFAULT_EXTRACTION_MODEL,
  type ExtractionClient,
  type ExtractionClientOptions,
  type ExtractionInput,
  type ExtractionResponse,
  TAXONOMY,
  toExtractionJsonSchema,
} from "@stonesoup/core";

export interface AnthropicExtractionEnv {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
}

const EXTRACTION_TOOL_NAME = "record_extraction";
const EXTRACTION_MAX_TOKENS = 4096;

export function createAnthropicExtractionClient(env: AnthropicExtractionEnv): ExtractionClient {
  const model = env.ANTHROPIC_MODEL || DEFAULT_EXTRACTION_MODEL;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  return {
    async extract(
      input: ExtractionInput,
      _options: ExtractionClientOptions,
    ): Promise<ExtractionResponse<unknown>> {
      if (input.modality === "text") {
        // STON-6's seam — the text modality node is declared but not
        // implemented in this ticket.
        throw new Error("anthropic-client: text modality extraction is not implemented (STON-6)");
      }

      const response = await client.messages.create({
        model,
        max_tokens: EXTRACTION_MAX_TOKENS,
        system: buildExtractionSystemPrompt(TAXONOMY),
        tools: [
          {
            name: EXTRACTION_TOOL_NAME,
            description: "Record the structured extraction of this receipt.",
            // biome-ignore lint/suspicious/noExplicitAny: the SDK's Tool.InputSchema type is a strict JSON Schema shape narrower than our generated Record<string, unknown>.
            input_schema: toExtractionJsonSchema(TAXONOMY) as any,
          },
        ],
        tool_choice: { type: "tool", name: EXTRACTION_TOOL_NAME },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  // biome-ignore lint/suspicious/noExplicitAny: the SDK narrows media_type to a fixed union; upload.ts already gates to JPEG/PNG.
                  media_type: input.image.mediaType as any,
                  data: input.image.dataBase64,
                },
              },
              { type: "text", text: "Extract this receipt." },
            ],
          },
        ],
      });

      const toolUse = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );
      if (!toolUse) {
        throw new Error("anthropic-client: extraction call returned no tool_use block");
      }

      return {
        result: toolUse.input,
        usage: {
          model: response.model,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    },
  };
}
