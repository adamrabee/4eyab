import { describe, expect, it } from "vitest";
import { ApiError } from "@google/genai";
import { GeminiProvider, type GeminiModels } from "@/lib/ai/gemini";
import { ExtractionError } from "@/lib/ai/provider";

type Call = Parameters<GeminiModels["generateContent"]>[0];

/** Fake Gemini client: records the request and returns a canned response. */
function fake(reply: { text?: string; finishReason?: string; blockReason?: string } | Error) {
  const calls: Call[] = [];
  const models = {
    generateContent: async (req: Call) => {
      calls.push(req);
      if (reply instanceof Error) throw reply;
      return {
        text: reply.text,
        candidates: [{ finishReason: reply.finishReason ?? "STOP" }],
        promptFeedback: reply.blockReason ? { blockReason: reply.blockReason } : undefined,
      };
    },
  } as unknown as GeminiModels;
  return { models, calls };
}

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
    expect(req.model).toBe("gemini-2.5-flash");
    const parts = (req.contents as { parts: { inlineData?: { mimeType: string; data: string }; text?: string }[] }[])[0].parts;
    expect(parts[0].inlineData).toEqual({ mimeType: "image/jpeg", data: img.toString("base64") });
    expect(parts[1].text).toMatch(/كشف أسماء/);
    expect(req.config?.responseMimeType).toBe("application/json");
    const schema = req.config?.responseJsonSchema as { type: string; properties: Record<string, unknown>; $schema?: string };
    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(["is_roster", "classroom", "students", "notes"]));
    expect(schema.$schema).toBeUndefined();
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
    const { models } = fake({
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
    ["invalid API key (Gemini returns 400)", new ApiError({ message: "API key not valid. Please pass a valid API key.", status: 400 }), /مفتاح/],
    ["unreadable file", new ApiError({ message: "Unable to process input image", status: 400 }), /تعذّرت قراءة الملف/],
    ["forbidden", new ApiError({ message: "permission denied", status: 403 }), /مفتاح/],
    ["quota", new ApiError({ message: "quota", status: 429 }), /مشغولة/],
    ["server", new ApiError({ message: "unavailable", status: 503 }), /تعذّر الاتصال/],
    ["network", new TypeError("fetch failed"), /تعذّر الاتصال/],
  ];
  for (const [name, reply, msg] of failures) {
    it(`gives a clear Arabic error on ${name}`, async () => {
      const { models } = fake(reply);
      const p = new GeminiProvider("k", undefined, models).extract({ kind: "roster", data: img, mime: "image/jpeg" });
      await expect(p).rejects.toBeInstanceOf(ExtractionError);
      await expect(p).rejects.toThrow(msg);
    });
  }

  it("refuses files too large to send inline", async () => {
    const { models, calls } = fake({ text: "{}" });
    const big = Buffer.alloc(15 * 1024 * 1024);
    await expect(new GeminiProvider("k", undefined, models).extract({ kind: "roster", data: big, mime: "application/pdf" })).rejects.toThrow(/كبير جدًا/);
    expect(calls).toHaveLength(0);
  });
});
