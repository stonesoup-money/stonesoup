/**
 * A deterministic `ExtractionClient` for tests — returns a fixture's
 * contents verbatim and a synthetic usage record, and never touches the
 * network (Review invariant 6: no test makes a live model call). Pair
 * with a JSON file under `fixtures/*.json`, imported directly
 * (`resolveJsonModule` is on).
 */

import type { ExtractionClient, ExtractionResponse } from "@stonesoup/core";

export function createFixtureExtractionClient(
  fixtureResult: unknown,
  model = "fixture-model",
): ExtractionClient {
  return {
    async extract(): Promise<ExtractionResponse<unknown>> {
      return {
        result: fixtureResult,
        usage: { model, inputTokens: 100, outputTokens: 50 },
      };
    },
  };
}
