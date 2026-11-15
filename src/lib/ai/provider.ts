import type { AllowedMime } from "./files";
import type { ExtractionKind, ExtractionResult } from "./schemas";

export interface ExtractionInput {
  kind: ExtractionKind;
  data: Buffer;
  mime: AllowedMime;
}

export interface ExtractionOutput {
  result: ExtractionResult;
  provider: "anthropic" | "mock";
  model: string;
}

export interface ExtractionProvider {
  readonly name: "anthropic" | "mock";
  extract(input: ExtractionInput): Promise<ExtractionOutput>;
}

/** Error whose message is safe to show to the teacher (Arabic). */
export class ExtractionError extends Error {
  constructor(public readonly userMessage: string, options?: { cause?: unknown }) {
    super(userMessage, options);
    this.name = "ExtractionError";
  }
}
