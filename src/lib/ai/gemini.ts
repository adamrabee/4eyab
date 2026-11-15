import "server-only";
import { ApiError, GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { ExtractionInput, ExtractionOutput, ExtractionProvider } from "./provider";
import { ExtractionError } from "./provider";
import { RosterExtraction, ScheduleExtraction } from "./schemas";
import { ROSTER_PROMPT, SCHEDULE_PROMPT, SYSTEM_PROMPT } from "./prompts";
import { normalizeRoster, normalizeSchedule } from "./normalize";

const DEFAULT_MODEL = "gemini-2.5-flash";

// Gemini accepts inline files up to ~20 MB per request; base64 adds ~33 %.
const MAX_INLINE_BYTES = 14 * 1024 * 1024;

/** JSON Schema for Gemini's structured output, generated from the same Zod schema we validate with. */
function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const out = { ...(z.toJSONSchema(schema) as Record<string, unknown>) };
  delete out.$schema;
  return out;
}

const SCHEMAS = {
  roster: { zod: RosterExtraction, json: jsonSchemaFor(RosterExtraction), prompt: ROSTER_PROMPT },
  schedule: { zod: ScheduleExtraction, json: jsonSchemaFor(ScheduleExtraction), prompt: SCHEDULE_PROMPT },
} as const;

/** Minimal surface we use, so tests can inject a fake client. */
export type GeminiModels = Pick<GoogleGenAI["models"], "generateContent">;

/**
 * Google Gemini Vision extraction (default model: gemini-2.5-flash).
 * The image/PDF is sent inline with a strict JSON schema; the reply is parsed,
 * validated against the same Zod schema, then cleaned (Arabic name
 * normalisation, de-duplication, time/period checks) before the teacher reviews it.
 */
export class GeminiProvider implements ExtractionProvider {
  readonly name = "gemini" as const;
  private models: GeminiModels;
  private model: string;

  constructor(apiKey: string, model?: string, models?: GeminiModels) {
    this.models = models ?? new GoogleGenAI({ apiKey, httpOptions: { timeout: 120_000 } }).models;
    this.model = model || DEFAULT_MODEL;
  }

  async extract({ kind, data, mime }: ExtractionInput): Promise<ExtractionOutput> {
    if (data.length > MAX_INLINE_BYTES) {
      throw new ExtractionError("الملف كبير جدًا للتحليل. صوّر الصفحة بدل رفع PDF كبير، أو قسّم الملف.");
    }
    const spec = SCHEMAS[kind];

    let text: string | undefined;
    let finish: string | undefined;
    let blocked: string | undefined;
    try {
      const res = await this.models.generateContent({
        model: this.model,
        contents: [
          {
            role: "user",
            parts: [{ inlineData: { mimeType: mime, data: data.toString("base64") } }, { text: spec.prompt }],
          },
        ],
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: "application/json",
          responseJsonSchema: spec.json,
          temperature: 0,
          maxOutputTokens: 32_000,
        },
      });
      text = res.text;
      finish = res.candidates?.[0]?.finishReason;
      blocked = res.promptFeedback?.blockReason;
    } catch (err) {
      if (err instanceof ApiError) {
        // Gemini reports an invalid key as 400 INVALID_ARGUMENT, not 401
        const keyProblem = err.status === 401 || err.status === 403 || /api[ _-]?key/i.test(err.message);
        if (keyProblem)
          throw new ExtractionError("مفتاح خدمة الذكاء الاصطناعي غير صالح. تواصل مع مسؤول المنصة.", { cause: err });
        if (err.status === 400) throw new ExtractionError("تعذّرت قراءة الملف. جرّب صورة أوضح أو ملفًا أصغر.", { cause: err });
        if (err.status === 429) throw new ExtractionError("الخدمة مشغولة حاليًا أو تجاوزت الحصة. حاول بعد دقيقة.", { cause: err });
        if (err.status >= 500) throw new ExtractionError("تعذّر الاتصال بخدمة الذكاء الاصطناعي. حاول مرة أخرى.", { cause: err });
      }
      throw new ExtractionError("تعذّر الاتصال بخدمة الذكاء الاصطناعي. حاول مرة أخرى.", { cause: err });
    }

    if (blocked || finish === "SAFETY" || finish === "PROHIBITED_CONTENT" || finish === "BLOCKLIST") {
      throw new ExtractionError("رفضت الخدمة معالجة هذا الملف. تأكد أنه كشف أسماء أو جدول دراسي.");
    }
    if (finish === "MAX_TOKENS") {
      throw new ExtractionError("الملف يحتوي بيانات أكثر من المسموح. قسّمه إلى صفحات أصغر.");
    }
    if (!text) throw new ExtractionError("لم نتمكن من فهم نتيجة التحليل. حاول مرة أخرى.");

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (err) {
      throw new ExtractionError("لم نتمكن من فهم نتيجة التحليل. حاول مرة أخرى.", { cause: err });
    }
    const parsed = spec.zod.safeParse(json);
    if (!parsed.success) {
      throw new ExtractionError("جاءت نتيجة التحليل بصيغة غير متوقعة. حاول مرة أخرى.", { cause: parsed.error });
    }

    return {
      provider: "gemini",
      model: this.model,
      result:
        kind === "roster"
          ? { kind, data: normalizeRoster(parsed.data as RosterExtraction) }
          : { kind, data: normalizeSchedule(parsed.data as ScheduleExtraction) },
    };
  }
}
