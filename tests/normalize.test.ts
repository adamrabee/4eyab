import { describe, expect, it } from "vitest";
import { cleanName, nameKey, normalizeRoster, normalizeSchedule, normalizeTime, toAsciiDigits } from "@/lib/ai/normalize";

describe("normalize helpers", () => {
  it("converts Arabic-Indic digits", () => {
    expect(toAsciiDigits("١٢٣٤٥٦٧٨٩٠")).toBe("1234567890");
    expect(toAsciiDigits("۱۲")).toBe("12");
  });

  it("cleans names: serials, tatweel, extra spaces", () => {
    expect(cleanName("  ١- محمـــد   عبدالله  ")).toBe("محمد عبدالله");
    expect(cleanName("12. سارة أحمد.")).toBe("سارة أحمد");
  });

  it("builds duplicate keys that ignore hamza/yaa/taa-marbuta variants", () => {
    expect(nameKey("أحمد إبراهيم")).toBe(nameKey("احمد ابراهيم"));
    expect(nameKey("فاطمة")).toBe(nameKey("فاطمه"));
    expect(nameKey("مصطفى")).toBe(nameKey("مصطفي"));
  });

  it("normalizes times", () => {
    expect(normalizeTime("7:05")).toBe("07:05");
    expect(normalizeTime("٧:٤٥")).toBe("07:45");
    expect(normalizeTime("25:00")).toBe("");
    expect(normalizeTime("")).toBe("");
  });
});

describe("normalizeRoster", () => {
  it("drops empty/duplicate names and keeps order", () => {
    const r = normalizeRoster({
      is_roster: true,
      classroom: { name: " ثاني أ ", grade: "", section: "" },
      students: [
        { full_name: "أحمد علي", student_number: "١٠٢", confidence: "high" },
        { full_name: "", student_number: "", confidence: "high" },
        { full_name: "احمد علي", student_number: "", confidence: "high" },
        { full_name: "خالد", student_number: " 1 2 ", confidence: "low" },
      ],
      notes: "",
    });
    expect(r.students.map((s) => s.full_name)).toEqual(["أحمد علي", "خالد"]);
    expect(r.students[0].student_number).toBe("102");
    expect(r.students[1].student_number).toBe("12");
    expect(r.classroom.name).toBe("ثاني أ");
  });
});

describe("normalizeSchedule", () => {
  it("drops invalid slots, free periods and dedupes by slot", () => {
    const s = normalizeSchedule({
      is_schedule: true,
      entries: [
        { day_of_week: 0, period_number: 1, start_time: "7:00", end_time: "7:45", classroom_name: "2/1", subject: "رياضيات", room: "", confidence: "high" },
        { day_of_week: 9, period_number: 1, start_time: "", end_time: "", classroom_name: "2/1", subject: "", room: "", confidence: "high" },
        { day_of_week: 1, period_number: 2, start_time: "", end_time: "", classroom_name: "", subject: "", room: "", confidence: "high" },
        { day_of_week: 0, period_number: 1, start_time: "", end_time: "", classroom_name: "3/2", subject: "", room: "", confidence: "high" },
        { day_of_week: 2, period_number: 3, start_time: "9:00", end_time: "8:00", classroom_name: "1/1", subject: "", room: "", confidence: "low" },
      ],
      notes: "",
    });
    expect(s.entries).toHaveLength(2);
    expect(s.entries[0]).toMatchObject({ day_of_week: 0, period_number: 1, classroom_name: "3/2" });
    expect(s.entries[1]).toMatchObject({ start_time: "09:00", end_time: "" });
  });
});
