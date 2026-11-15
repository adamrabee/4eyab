import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { ExtractionInput, ExtractionOutput, ExtractionProvider } from "./provider";
import { ExtractionError } from "./provider";
import { RosterExtraction, ScheduleExtraction } from "./schemas";
import { ROSTER_PROMPT, SCHEDULE_PROMPT, SYSTEM_PROMPT } from "./prompts";
import { normalizeRoster, normalizeSchedule } from "./normalize";

const DEFAULT_MODEL = "claude-opus-5-5";

/**
 * Claude Vision extraction. Uses structured outputs so the response always
 * matches our schema, and server-side refusal fallbacks so a rare safety
 * decline on a benign document is retried on another model automatically.
 */
export class AnthropicProvider implements ExtractionProvider {
  readonly name = "anthropic" as const;
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 2 });
    this.model = model || DEFAULT_MODEL;
  }

  async extract({ kind, data, mime }: ExtractionInput): Promise<ExtractionOutput> {
    const b64 = data.toString("base64");
    const fileBlock =
      mime === "application/pdf"
        ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } } as const)
        : ({ type: "image", source: { type: "base64", media_type: mime, data: b64 } } as const);

    const schema = kind === "roster" ? RosterExtraction : ScheduleExtraction;

    let message;
    try {
      const stream = this.client.beta.messages.stream({
        model: this.model,
        max_tokens: 32_000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM_PROMPT,
        output_config: { effort: "high", format: betaZodOutputFormat(schema) },
        messages: [
          {
            role: "user",
            content: [fileBlock, { type: "text", text: kind === "roster" ? ROSTER_PROMPT : SCHEDULE_PROMPT }],
          },
        ],
      });
      message = await stream.finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw new ExtractionError("مفتاح خدمة الذكاء الاصطناعي غير صالح. تواصل مع مسؤول المنصة.", { cause: err });
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new ExtractionError("الخدمة مشغولة حاليًا. حاول بعد دقيقة.", { cause: err });
      }
      if (err instanceof Anthropic.BadRequestError) {
        throw new ExtractionError("تعذّرت قراءة الملف. جرّب صورة أوضح أو ملفًا أصغر.", { cause: err });
      }
      if (err instanceof Anthropic.APIConnectionError || err instanceof Anthropic.InternalServerError) {
        throw new ExtractionError("تعذّر الاتصال بخدمة الذكاء الاصطناعي. حاول مرة أخرى.", { cause: err });
      }
      throw new ExtractionError("حدث خطأ غير متوقع أثناء التحليل.", { cause: err });
    }

    if (message.stop_reason === "refusal") {
      throw new ExtractionError("رفضت الخدمة معالجة هذا الملف. تأكد أنه كشف أسماء أو جدول دراسي.");
    }
    if (message.stop_reason === "max_tokens") {
      throw new ExtractionError("الملف يحتوي بيانات أكثر من المسموح. قسّمه إلى صفحات أصغر.");
    }
    const parsed = message.parsed_output;
    if (!parsed) throw new ExtractionError("لم نتمكن من فهم نتيجة التحليل. حاول مرة أخرى.");

    return {
      provider: "anthropic",
      model: message.model,
      result:
        kind === "roster"
          ? { kind, data: normalizeRoster(parsed as RosterExtraction) }
          : { kind, data: normalizeSchedule(parsed as ScheduleExtraction) },
    };
  }
}
