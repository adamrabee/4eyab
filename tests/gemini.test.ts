import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@google/genai";
import { GeminiProvider, pickFlashModel, resetGeminiDiscovery, type GeminiModels } from "@/lib/ai/gemini";
import { ExtractionError } from "@/lib/ai/provider";

type Call = Parameters<GeminiModels["generateContent"]>[0];

type Reply = { text?: string; finishReason?: string; blockReason?: string } | Error;

/** Fake Gemini client: records requests and returns canned replies (one per call; the last one repeats). */
function fake(reply: Reply | Reply[], available: { name: string; supportedActions?: string[] }[] = []) {
  const calls: Call[] = [];
  const replies = Array.isArray(reply) ? reply : [reply];
  let listed = 0;
  const models = {
    generateContent: async (req: Call) => {
      calls.push(req);
      const r = replies[Math.min(calls.length - 1, replies.length - 1)];
      if (r instanceof Error) throw r;
      return {
        text: r.text,
        candidates: [{ finishReason: r.finishReason ?? "STOP" }],
        promptFeedback: r.blockReason ? { blockReason: r.blockReason } : undefined,
      };
    },
    list: async () => {
      listed++;
      return (async function* () {
        yield* available;
      })();
    },
  } as unknown as GeminiModels;
  return { models, calls, listCount: () => listed };
}

beforeEach(() => resetGeminiDiscovery());

const img = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

describe("GeminiProvider", () => {
  it("sends the image inline with a strict JSON schema and returns cleaned Arabic names", async () => {
    const { models, calls } = fake({
      text: JSON.stringify({
        is_roster: true,
        classroom: { name: "الثاني المتوسط / ١", grade: "", section: "" },
        students: [
          { full_name: "١- محمـــد  عبدالله", student_number: "١٠٢٣", confidence: "high" },
          { full_name: "سارة أحمد", student_number: "", confidence: "low" },
          { full_name: "سارة احمد", student_number: "", confidence: "high" }, // duplicate (hamza variant)
          { full_name: "", student_number: "", confidence: "high" },
        ],
        notes: "",
      }),
    });
    const out = await new GeminiProvider("test-key", undefined, models).extract({ kind: "roster", data: img, mime: "image/jpeg" });

    // request shape
    expect(calls).toHaveLength(1);
    const req = calls[0];
    expect(req.model).toBe("gemini-3.8-flash");
    const parts = (req.contents as { parts: { inlineData?: { mimeType: string; data: string }; text?: string }[] }[])[0].parts;
    expect(parts[0].inlineData).toEqual({ mimeType: "image/jpeg", data: img.toString("base64") });
    expect(parts[1].text).toMatch(/كشف أسماء/);
    expect(req.config?.responseMimeType).toBe("application/json");
    const schema = req.config?.responseJsonSchema as { type: string; properties: Record<string, unknown>; $schema?: string };
    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(["is_roster", "classroom", "students", "notes"]));
    expect(schema.$schema).toBeUndefined();
    expect(JSON.stringify(schema)).not.toContain("9007199254740991");
    expect(req.config?.temperature).toBe(0);

    // result
    expect(out.provider).toBe("gemini");
    expect(out.result.kind).toBe("roster");
    if (out.result.kind !== "roster") return;
    expect(out.result.data.students.map((s) => s.full_name)).toEqual(["محمد عبدالله", "سارة أحمد"]);
    expect(out.result.data.students[0].student_number).toBe("1023");
    expect(out.result.data.students[1].confidence).toBe("low");
  });

  it("extracts a timetable and drops invalid slots", async () => {
    const { models, calls } = fake({
      text: JSON.stringify({
        is_schedule: true,
        entries: [
          { day_of_week: 0, period_number: 1, start_time: "٧:٠٠", end_time: "7:45", classroom_name: "2/1", subject: "لغتي", room: "", confidence: "high" },
          { day_of_week: 8, period_number: 1, start_time: "", end_time: "", classroom_name: "2/1", subject: "", room: "", confidence: "high" },
        ],
        notes: "",
      }),
    });
    const out = await new GeminiProvider("k", undefined, models).extract({ kind: "schedule", data: img, mime: "image/jpeg" });
    if (out.result.kind !== "schedule") throw new Error("wrong kind");
    expect(JSON.stringify(calls[0].config?.responseJsonSchema)).not.toContain("9007199254740991");
    expect(out.result.data.entries).toHaveLength(1);
    expect(out.result.data.entries[0]).toMatchObject({ start_time: "07:00", end_time: "07:45", subject: "لغتي" });
  });

  it("passes PDFs as application/pdf", async () => {
    const { models, calls } = fake({ text: JSON.stringify({ is_roster: true, classroom: { name: "", grade: "", section: "" }, students: [], notes: "" }) });
    await new GeminiProvider("k", undefined, models).extract({ kind: "roster", data: Buffer.from("%PDF-1.7 test"), mime: "application/pdf" });
    const parts = (calls[0].contents as { parts: { inlineData?: { mimeType: string } }[] }[])[0].parts;
    expect(parts[0].inlineData?.mimeType).toBe("application/pdf");
  });

  it("uses GEMINI_MODEL override when given", async () => {
    const { models, calls } = fake({ text: JSON.stringify({ is_roster: true, classroom: { name: "", grade: "", section: "" }, students: [], notes: "" }) });
    await new GeminiProvider("k", "gemini-2.5-pro", models).extract({ kind: "roster", data: img, mime: "image/jpeg" });
    expect(calls[0].model).toBe("gemini-2.5-pro");
  });

  const failures: [string, Parameters<typeof fake>[0], RegExp][] = [
    ["safety block", { text: "", finishReason: "SAFETY" }, /رفضت الخدمة/],
    ["prompt blocked", { text: "", blockReason: "OTHER" }, /رفضت الخدمة/],
    ["truncated output", { text: '{"is_roster":true', finishReason: "MAX_TOKENS" }, /أكثر من المسموح/],
    ["not JSON", { text: "sorry, I cannot" }, /لم نتمكن من فهم/],
    ["wrong shape", { text: JSON.stringify({ hello: "world" }) }, /صيغة غير متوقعة/],
    ["invalid API key (Gemini returns 400)", new ApiError({ message: "API key not valid. Please pass a valid API key.", status: 400 }), /GEMINI_API_KEY.*رمز الخطأ: 400/],
    ["API disabled in the Google project", new ApiError({ message: "Generative Language API has not been used in project 123 before or it is disabled. SERVICE_DISABLED", status: 403 }), /غير مفعّلة.*رمز الخطأ: 403/],
    ["key restricted", new ApiError({ message: "Requests from referer <empty> are blocked. PERMISSION_DENIED", status: 403 }), /لا يملك صلاحية.*رمز الخطأ: 403/],
    ["unknown model", new ApiError({ message: "models/gemini-x is not found for API version v1beta", status: 404 }), /غير متاح.*رمز الخطأ: 404/],
    ["unsupported region", new ApiError({ message: "User location is not supported for the API use.", status: 400 }), /منطقة الخادم.*رمز الخطأ: 400/],
    ["unreadable file", new ApiError({ message: "Unable to process input image", status: 400 }), /تعذّرت قراءة الملف.*رمز الخطأ: 400/],
    ["quota", new ApiError({ message: "RESOURCE_EXHAUSTED: quota exceeded", status: 429 }), /حصة.*رمز الخطأ: 429/],
    ["server", new ApiError({ message: "unavailable", status: 503 }), /مؤقتة.*رمز الخطأ: 503/],
    ["network", new TypeError("fetch failed"), /رمز الخطأ: network/],
  ];
  for (const [name, reply, msg] of failures) {
    it(`gives a clear Arabic error on ${name}`, async () => {
      const { models } = fake(reply);
      const p = new GeminiProvider("k", undefined, models, { retryDelaysMs: [1, 1] }).extract({ kind: "roster", data: img, mime: "image/jpeg" });
      await expect(p).rejects.toBeInstanceOf(ExtractionError);
      await expect(p).rejects.toThrow(msg);
    });
  }

  it("falls back to an available Flash model when the configured one is gone (404), and remembers it", async () => {
    const ok = { text: JSON.stringify({ is_roster: true, classroom: { name: "", grade: "", section: "" }, students: [{ full_name: "خالد", student_number: "", confidence: "high" }], notes: "" }) };
    const gone = new ApiError({ message: "models/gemini-3.8-flash is not found for API version v1beta", status: 404 });
    const { models, calls, listCount } = fake([gone, ok], [
      { name: "models/gemini-3.9-flash-lite", supportedActions: ["generateContent"] },
      { name: "models/gemini-3.9-flash", supportedActions: ["generateContent", "countTokens"] },
      { name: "models/text-embedding-005", supportedActions: ["embedContent"] },
    ]);
    const p = new GeminiProvider("k", undefined, models);
    const out = await p.extract({ kind: "roster", data: img, mime: "image/jpeg" });
    expect(calls.map((c) => c.model)).toEqual(["gemini-3.8-flash", "gemini-3.9-flash"]);
    expect(out.model).toBe("gemini-3.9-flash");
    // next request goes straight to the discovered model, no second lookup
    await p.extract({ kind: "roster", data: img, mime: "image/jpeg" });
    expect(calls.at(-1)?.model).toBe("gemini-3.9-flash");
    expect(listCount()).toBe(1);
  });

  const fast = { retryDelaysMs: [1, 1] };
  const okRoster = { text: JSON.stringify({ is_roster: true, classroom: { name: "", grade: "", section: "" }, students: [{ full_name: "فهد", student_number: "", confidence: "high" }], notes: "" }) };
  const overloaded = () => new ApiError({ message: "The model is overloaded. Please try again later.", status: 503 });

  it("retries automatically when Gemini is temporarily overloaded (503)", async () => {
    const { models, calls } = fake([overloaded(), overloaded(), okRoster]);
    const out = await new GeminiProvider("k", undefined, models, fast).extract({ kind: "roster", data: img, mime: "image/jpeg" });
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.model === "gemini-3.8-flash")).toBe(true);
    expect(out.result.kind === "roster" && out.result.data.students[0].full_name).toBe("فهد");
  });

  it("switches to another Flash model when the first stays overloaded, without remembering it", async () => {
    const { models, calls } = fake([overloaded(), overloaded(), overloaded(), okRoster, okRoster], [
      { name: "models/gemini-3.8-flash", supportedActions: ["generateContent"] },
      { name: "models/gemini-3.5-flash", supportedActions: ["generateContent"] },
    ]);
    const p = new GeminiProvider("k", undefined, models, fast);
    const out = await p.extract({ kind: "roster", data: img, mime: "image/jpeg" });
    expect(calls.map((c) => c.model)).toEqual(["gemini-3.8-flash", "gemini-3.8-flash", "gemini-3.8-flash", "gemini-3.5-flash"]);
    expect(out.model).toBe("gemini-3.5-flash");
    await p.extract({ kind: "roster", data: img, mime: "image/jpeg" });
    expect(calls.at(-1)?.model).toBe("gemini-3.8-flash"); // overload is temporary: go back to the default
  });

  it("gives up with a clear 503 message when everything stays overloaded", async () => {
    const { models, calls } = fake(overloaded(), [{ name: "models/gemini-3.5-flash", supportedActions: ["generateContent"] }]);
    await expect(new GeminiProvider("k", undefined, models, fast).extract({ kind: "roster", data: img, mime: "image/jpeg" })).rejects.toThrow(/مؤقتة.*503/);
    expect(calls).toHaveLength(6); // 3 attempts × 2 models, then stop
  });

  it("does not retry errors that won't fix themselves (e.g. invalid key)", async () => {
    const { models, calls } = fake(new ApiError({ message: "API key not valid", status: 400 }));
    await expect(new GeminiProvider("k", undefined, models, fast).extract({ kind: "roster", data: img, mime: "image/jpeg" })).rejects.toThrow(/GEMINI_API_KEY/);
    expect(calls).toHaveLength(1);
  });

  it("stops retrying when the time budget is nearly used up", async () => {
    const { models, calls } = fake(overloaded(), [{ name: "models/gemini-3.5-flash", supportedActions: ["generateContent"] }]);
    await expect(
      new GeminiProvider("k", undefined, models, { retryDelaysMs: [1, 1], budgetMs: 1_000 }).extract({ kind: "roster", data: img, mime: "image/jpeg" }),
    ).rejects.toThrow(/503/);
    expect(calls).toHaveLength(1);
  });

  it("keeps the clear 404 message when no alternative model exists", async () => {
    const gone = new ApiError({ message: "not found", status: 404 });
    const { models } = fake(gone, [{ name: "models/text-embedding-005", supportedActions: ["embedContent"] }]);
    await expect(new GeminiProvider("k", undefined, models).extract({ kind: "roster", data: img, mime: "image/jpeg" })).rejects.toThrow(/غير متاح.*404/);
  });

  it("refuses files too large to send inline", async () => {
    const { models, calls } = fake({ text: "{}" });
    const big = Buffer.alloc(15 * 1024 * 1024);
    await expect(new GeminiProvider("k", undefined, models).extract({ kind: "roster", data: big, mime: "application/pdf" })).rejects.toThrow(/كبير جدًا/);
    expect(calls).toHaveLength(0);
  });
});

describe("pickFlashModel", () => {
  const m = (name: string, actions = ["generateContent"]) => ({ name: `models/${name}`, supportedActions: actions });
  it("prefers the newest stable general Flash model", () => {
    expect(
      pickFlashModel([
        m("gemini-2.5-flash"),
        m("gemini-3.8-flash-lite"),
        m("gemini-3.8-flash"),
        m("gemini-3.8-flash-image"),
        m("gemini-3.9-flash-preview-10-2026"),
        m("gemini-flash-latest"),
        m("gemini-3.8-pro"),
        m("text-embedding-005", ["embedContent"]),
      ]),
    ).toBe("gemini-3.8-flash");
  });
  it("uses a preview only when nothing stable exists", () => {
    expect(pickFlashModel([m("gemini-4-flash-preview-01"), m("gemini-4-flash-lite")])).toBe("gemini-4-flash-preview-01");
  });
  it("accepts the latest alias when it's the only Flash", () => {
    expect(pickFlashModel([m("gemini-flash-latest"), m("gemini-3.8-pro")])).toBe("gemini-flash-latest");
  });
  it("skips models that can't generate content, and returns null if none fit", () => {
    expect(pickFlashModel([m("gemini-3.8-flash", ["countTokens"])])).toBeNull();
    expect(pickFlashModel([])).toBeNull();
  });
});
