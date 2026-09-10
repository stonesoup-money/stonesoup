/**
 * The extraction client seam. `ExtractionInput` is a discriminated union:
 * the `text` variant is declared and parsed now, unimplemented — that
 * declaration is STON-6's (email path) seam, exercising it is out of
 * scope here. `ExtractionClient` is implemented for real in
 * `packages/worker/src/extraction/anthropic-client.ts` (the live
 * Anthropic call) and by a fixture client used only by tests — no test
 * makes a live model call (Review invariant 6).
 */

export type ExtractionModality = "vision" | "text";

export type ExtractionInput =
  | { modality: "vision"; image: { mediaType: string; dataBase64: string } }
  | { modality: "text"; text: string };

export interface ExtractionUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ExtractionResponse<TResult> {
  result: TResult;
  usage: ExtractionUsage;
}

export interface ExtractionClientOptions {
  schemaVersion: number;
  taxonomyVersion: string;
}

/** `TResult` is left generic here rather than importing `ExtractionResult`
 * directly, so this module (and the fixture client tests exercise it
 * with) never needs to import `parse.ts` — the client's job is to return
 * *raw* model output; the caller runs it through `parseExtractionResult`. */
export interface ExtractionClient<TResult = unknown> {
  extract(
    input: ExtractionInput,
    options: ExtractionClientOptions,
  ): Promise<ExtractionResponse<TResult>>;
}

/** The queue message shape a producer enqueues and the consumer reads
 * (`EXTRACTION_QUEUE` in wrangler.jsonc). */
export interface ExtractionJob {
  receiptId: string;
  r2Key: string;
  userId: string;
  modality: ExtractionModality;
  schemaVersion: number;
}
