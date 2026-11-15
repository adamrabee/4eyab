import "server-only";
import type { ExtractionInput, ExtractionOutput, ExtractionProvider } from "./provider";
import { normalizeRoster, normalizeSchedule } from "./normalize";

/**
 * Development stand-in used when no Anthropic key is configured (AI_PROVIDER=mock).
 * It does NOT read the uploaded file. It returns obviously-sample data so the full
 * upload → review → approve flow can be tested, and the UI labels it as mock.
 */
export class MockProvider implements ExtractionProvider {
  readonly name = "mock" as const;

  async extract({ kind }: ExtractionInput): Promise<ExtractionOutput> {
    await new Promise((r) => setTimeout(r, 400));
    if (kind === "roster") {
      return {
        provider: "mock",
        model: "mock",
        result: {
          kind,
          data: normalizeRoster({
            is_roster: true,
            classroom: { name: "فصل تجريبي", grade: "", section: "" },
            students: Array.from({ length: 8 }, (_, i) => ({
              full_name: `طالب تجريبي ${i + 1}`,
              student_number: "",
              confidence: i === 6 ? ("low" as const) : ("high" as const),
            })),
            notes: "بيانات تجريبية: لم يُقرأ الملف المرفوع لأن خدمة الذكاء الاصطناعي غير مفعّلة.",
          }),
        },
      };
    }
    const entries = [];
    for (let day = 0; day <= 4; day++) {
      for (const period of [1, 3, 5]) {
        entries.push({
          day_of_week: day,
          period_number: period,
          start_time: "",
          end_time: "",
          classroom_name: period === 3 ? "فصل تجريبي ب" : "فصل تجريبي",
          subject: "مادة تجريبية",
          room: "",
          confidence: "high" as const,
        });
      }
    }
    return {
      provider: "mock",
      model: "mock",
      result: {
        kind,
        data: normalizeSchedule({
          is_schedule: true,
          entries,
          notes: "بيانات تجريبية: لم يُقرأ الملف المرفوع لأن خدمة الذكاء الاصطناعي غير مفعّلة.",
        }),
      },
    };
  }
}
