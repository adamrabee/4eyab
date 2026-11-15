import "server-only";
import { ApiError, GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { ExtractionInput, ExtractionOutput, ExtractionProvider } from "./provider";
import { ExtractionError } from "./provider";
import { RosterExtraction, ScheduleExtraction } from "./schemas";
import { ROSTER_PROMPT, SCHEDULE_PROMPT, SYSTEM_PROMPT } from "./prompts";
import { normalizeRoster, normalizeSchedule } from "./normalize";

// Google limited the 2.5 models to existing users; new keys get 404 on them.
// Current docs use gemini-3.8-flash. If a model is ever unavailable (404), the
// provider discovers the best Flash model this key can use and retries once.
export const DEFAULT_MODEL = "gemini-3.8-flash";

/** Model found through discovery, reused by later requests on this server instance. */
let discoveredModel: string | null = null;

/** Test helper: forget any discovered model. */
export function resetGeminiDiscovery() {
  discoveredModel = null;
}

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
export type GeminiModels = Pick<GoogleGenAI["models"], "generateContent" | "list">;

type ModelInfo = { name?: string; supportedActions?: string[] };

/**
 * Choose the best general-purpose Flash model from a model list: it must support
 * generateContent, and stable, highest-version models win. Specialised or
 * experimental variants (lite, image, audio/tts, live, embedding, exp) are skipped;
 * previews are used only when nothing stable exists.
 */
export function pickFlashModel(models: ModelInfo[]): string | null {
  const SKIP = /lite|image|tts|audio|live|embed|exp|thinking|8b|robotics|computer/i;
  const cands = models
    .map((m) => ({ id: (m.name ?? "").replace(/^models\//, ""), actions: m.supportedActions }))
    .filter((m) => m.id && /flash/i.test(m.id) && !SKIP.test(m.id))
    .filter((m) => !m.actions || m.actions.includes("generateContent"));
  if (!cands.length) return null;
  const version = (id: string) => Number(id.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  const isPreview = (id: string) => /preview/i.test(id);
  const isAlias = (id: string) => /latest/i.test(id);
  const rank = (id: string) => [isPreview(id) ? 0 : 1, version(id), isAlias(id) ? 0 : 1, -id.length];
  cands.sort((a, b) => {
    const ra = rank(a.id), rb = rank(b.id);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return rb[i] - ra[i];
    return 0;
  });
  return cands[0].id;
}

/**
 * Google Gemini Vision extraction (default model: gemini-3.8-flash, with automatic
 * fallback to an available Flash model if the configured one returns 404).
 * The image/PDF is sent inline with a strict JSON schema; the reply is parsed,
 * validated against the same Zod schema, then cleaned (Arabic name
 * normalisation, de-duplication, time/period checks) before the teacher reviews it.
 */
/** Temporary server-side failures worth retrying (503 = model overloaded). */
function isTransient(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 500 || err.status === 502 || err.status === 503 || err.status === 504);
}

export class GeminiProvider implements ExtractionProvider {
  readonly name = "gemini" as const;
  private models: GeminiModels;
  private model: string;
  private retryDelaysMs: number[];
  private budgetMs: number;

  constructor(apiKey: string, model?: string, models?: GeminiModels, opts?: { retryDelaysMs?: number[]; budgetMs?: number }) {
    this.models = models ?? new GoogleGenAI({ apiKey, httpOptions: { timeout: 90_000 } }).models;
    this.model = model || DEFAULT_MODEL;
    // waits between attempts when Gemini is temporarily overloaded (503 etc.)
    this.retryDelaysMs = opts?.retryDelaysMs ?? [2_000, 5_000];
    this.budgetMs = opts?.budgetMs ?? 150_000;
  }

  /** Ask Google which models this key can use and pick the best Flash model other than `exclude`. */
  private async discover(exclude?: string): Promise<string | null> {
    const found: ModelInfo[] = [];
    const pager = await this.models.list({ config: { pageSize: 100 } });
    for await (const m of pager) {
      if (m.name?.replace(/^models\//, "") === exclude) continue;
      found.push({ name: m.name, supportedActions: m.supportedActions });
      if (found.length >= 300) break;
    }
    return pickFlashModel(found);
  }

  async extract({ kind, data, mime }: ExtractionInput): Promise<ExtractionOutput> {
    if (data.length > MAX_INLINE_BYTES) {
      throw new ExtractionError("الملف كبير جدًا للتحليل. صوّر الصفحة بدل رفع PDF كبير، أو قسّم الملف.");
    }
    const spec = SCHEMAS[kind];

    const request = (model: string) =>
      this.models.generateContent({
        model,
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

    // Stay well inside the hosting function's time limit (route maxDuration = 180 s).
    const deadline = Date.now() + this.budgetMs;

    // Call a model, retrying temporary overloads (503 …) with short waits.
    const attempt = async (m: string) => {
      for (let i = 0; ; i++) {
        try {
          return await request(m);
        } catch (err) {
          const wait = this.retryDelaysMs[i];
          if (!isTransient(err) || wait === undefined || Date.now() + wait + 15_000 > deadline) throw err;
          console.warn("gemini: temporary error, retrying", { model: m, status: (err as ApiError).status, attempt: i + 1 });
          await new Promise((r) => setTimeout(r, this.retryDelaysMs[i]));
        }
      }
    };

    let model = discoveredModel ?? this.model;
    let res: Awaited<ReturnType<typeof request>>;
    try {
      res = await attempt(model);
    } catch (err) {
      // 404: model retired / not available to this key. Persistent 5xx: model
      // overloaded. Either way, try the best other Flash model once.
      const unavailable = err instanceof ApiError && err.status === 404;
      if ((!unavailable && !isTransient(err)) || Date.now() + 20_000 > deadline) throw geminiError(err, model);
      const fallback = await this.discover(model).catch(() => null);
      if (!fallback) throw geminiError(err, model);
      console.warn("gemini: switching model", { from: model, to: fallback, reason: (err as ApiError).status });
      try {
        res = await attempt(fallback);
      } catch (err2) {
        throw geminiError(err2, fallback);
      }
      model = fallback;
      if (unavailable) discoveredModel = fallback; // remember only when the old model is gone
    }
    const text = res.text;
    const finish = res.candidates?.[0]?.finishReason;
    const blocked = res.promptFeedback?.blockReason;

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
      model,
      result:
        kind === "roster"
          ? { kind, data: normalizeRoster(parsed.data as RosterExtraction) }
          : { kind, data: normalizeSchedule(parsed.data as ScheduleExtraction) },
    };
  }
}
