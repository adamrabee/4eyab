import "server-only";
import { AnthropicProvider } from "./anthropic";
import { MockProvider } from "./mock";
import type { ExtractionProvider } from "./provider";

export type AiStatus = { provider: "anthropic" | "mock"; configured: boolean };

/** Which provider is active, without exposing any secret. */
export function aiStatus(): AiStatus {
  const wanted = (process.env.AI_PROVIDER ?? "mock").toLowerCase();
  if (wanted === "anthropic") return { provider: "anthropic", configured: Boolean(process.env.ANTHROPIC_API_KEY) };
  return { provider: "mock", configured: true };
}

export function getProvider(): ExtractionProvider {
  const s = aiStatus();
  if (s.provider === "anthropic") {
    if (!s.configured) throw new Error("AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set");
    return new AnthropicProvider(process.env.ANTHROPIC_API_KEY!, process.env.ANTHROPIC_MODEL || undefined);
  }
  return new MockProvider();
}
