import "server-only";
import { AnthropicProvider } from "./anthropic";
import { GeminiProvider } from "./gemini";
import { MockProvider } from "./mock";
import type { ExtractionProvider, ProviderName } from "./provider";

export type AiStatus = { provider: ProviderName; configured: boolean };

/**
 * Which provider is active (AI_PROVIDER = gemini | anthropic | mock), without
 * exposing any secret. Unknown/empty values fall back to the labelled mock.
 */
export function aiStatus(): AiStatus {
  const wanted = (process.env.AI_PROVIDER ?? "mock").trim().toLowerCase();
  if (wanted === "gemini") return { provider: "gemini", configured: Boolean(process.env.GEMINI_API_KEY?.trim()) };
  if (wanted === "anthropic") return { provider: "anthropic", configured: Boolean(process.env.ANTHROPIC_API_KEY?.trim()) };
  return { provider: "mock", configured: true };
}

export function getProvider(): ExtractionProvider {
  const s = aiStatus();
  if (!s.configured) throw new Error(`AI_PROVIDER=${s.provider} but its API key is not set`);
  if (s.provider === "gemini") return new GeminiProvider(process.env.GEMINI_API_KEY!.trim(), process.env.GEMINI_MODEL || undefined);
  if (s.provider === "anthropic") return new AnthropicProvider(process.env.ANTHROPIC_API_KEY!.trim(), process.env.ANTHROPIC_MODEL || undefined);
  return new MockProvider();
}
