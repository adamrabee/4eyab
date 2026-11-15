import type { AllowedMime } from "./files";
import type { ExtractionKind, ExtractionResult } from "./schemas";

export type ProviderName = "anthropic" | "gemini" | "mock";

export interface ExtractionInput {
  kind: ExtractionKind;
  data: Buffer;
  mime: AllowedMime;
}

export interface ExtractionOutput {
  result: ExtractionResult;
  provider: ProviderName;
  model: string;
}

export interface ExtractionProvider {
  readonly name: ProviderName;
  extract(input: ExtractionInput): Promise<ExtractionOutput>;
}

/** Error whose message is safe to show to the teacher (Arabic). */
export class ExtractionError extends Error {
  constructor(public readonly userMessage: string, options?: { cause?: unknown }) {
    super(userMessage, options);
    this.name = "ExtractionError";
  }
}
