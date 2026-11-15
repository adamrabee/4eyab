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

/** Zod adds ±MAX_SAFE_INTEGER bounds to .int() fields; they carry no meaning, so drop them. */
function stripSafeIntBounds(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripSafeIntBounds);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if ((k === "minimum" || k === "maximum") && typeof v === "number" && Math.abs(v) >= Number.MAX_SAFE_INTEGER) continue;
    out[k] = stripSafeIntBounds(v);
  }
  return out;
}

/** JSON Schema for Gemini's structured output, generated from the same Zod schema we validate with. */
function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const out = { ...(z.toJSONSchema(schema) as Record<string, unknown>) };
  delete out.$schema;
  return stripSafeIntBounds(out) as Record<string, unknown>;
}

const SCHEMAS = {
  roster: { zod: RosterExtraction, json: jsonSchemaFor(RosterExtraction), prompt: ROSTER_PROMPT },
  schedule: { zod: ScheduleExtraction, json: jsonSchemaFor(ScheduleExtraction), prompt: SCHEDULE_PROMPT },
} as const;

/**
 * Turn a Gemini/network failure into a clear Arabic message for the teacher.
 * The HTTP status is appended (e.g. "رمز الخطأ: 404") so problems can be
 * diagnosed from a screenshot; the original error stays attached as `cause`.
 */
export function geminiError(err: unknown, model: string): ExtractionError {
  if (!(err instanceof ApiError)) {
    return new ExtractionError("تعذّر الاتصال بخدمة Gemini. تحقّق من الاتصال وحاول مرة أخرى. (رمز الخطأ: network)", { cause: err });
  }
  const s = err.status;
  const m = err.message ?? "";
  const code = ` (رمز الخطأ: ${s})`;
  const make = (msg: string) => new ExtractionError(msg + code, { cause: err });

  // Gemini reports an invalid key as 400 INVALID_ARGUMENT, not 401
  if (/api[ _-]?key (not valid|invalid|expired)|API_KEY_INVALID|API key expired/i.test(m) || s === 401)
    return make("مفتاح Gemini غير صالح. تأكد من نسخ GEMINI_API_KEY كاملًا في Vercel ثم أعد النشر.");
  if (/SERVICE_DISABLED|has not been used in project|is disabled|API has not been enabled/i.test(m))
    return make("واجهة Gemini غير مفعّلة في مشروع Google التابع لهذا المفتاح. فعّل «Generative Language API» أو أنشئ المفتاح من Google AI Studio.");
  if (/location is not supported|not available in your (country|region)/i.test(m))
    return make("خدمة Gemini غير متاحة من منطقة الخادم.");
  if (s === 403 || /PERMISSION_DENIED|referer|referrer|blocked/i.test(m))
    return make("مفتاح Gemini لا يملك صلاحية لهذه الخدمة. أزل أي قيود على المفتاح (المواقع/التطبيقات) أو استخدم مفتاحًا من Google AI Studio.");
  if (s === 404 || /not found|is not supported for generateContent/i.test(m))
    return make(`نموذج Gemini «${model}» غير متاح لهذا المفتاح. احذف GEMINI_MODEL من Vercel أو اختر نموذجًا متاحًا.`);
  if (s === 429 || /RESOURCE_EXHAUSTED|quota/i.test(m))
    return make("تجاوزت حصة Gemini المسموحة أو الخدمة مشغولة. انتظر دقيقة وحاول مرة أخرى، أو فعّل الفوترة في Google AI Studio.");
  if (s >= 500) return make("خدمة Gemini تواجه مشكلة مؤقتة. حاول مرة أخرى بعد قليل.");
  if (s === 400) return make("تعذّرت قراءة الملف. جرّب صورة أوضح أو ملفًا أصغر.");
  return make("تعذّر الاتصال بخدمة Gemini. حاول مرة أخرى.");
}

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
      throw geminiError(err, this.model);
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
