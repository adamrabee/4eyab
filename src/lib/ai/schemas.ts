import { z } from "zod";

// Schemas sent to the model as structured-output formats. Kept free of
// min/max refinements (not all are supported in output schemas); range checks
// and cleanup happen in normalize.ts after parsing.

export const Confidence = z.enum(["high", "medium", "low"]);

export const RosterExtraction = z.object({
  is_roster: z.boolean().describe("false if the document is not a list of student names"),
  classroom: z.object({
    name: z.string().describe("Class label as written, e.g. 'الصف الثاني أ' or '2/1'. Empty if absent."),
    grade: z.string().describe("Grade level if written, e.g. 'الثاني المتوسط'. Empty if absent."),
    section: z.string().describe("Section/division if written, e.g. 'أ' or '1'. Empty if absent."),
  }),
  students: z.array(
    z.object({
      full_name: z.string().describe("Student full name exactly as written, in original script"),
      student_number: z.string().describe("ID / serial / civil number if present in the row, else empty"),
      confidence: Confidence.describe("low if the name is partly illegible or guessed"),
    }),
  ),
  notes: z.string().describe("Short Arabic note about problems (illegible rows, cut-off page). Empty if none."),
});
export type RosterExtraction = z.infer<typeof RosterExtraction>;

export const ScheduleExtraction = z.object({
  is_schedule: z.boolean().describe("false if the document is not a weekly class timetable"),
  entries: z.array(
    z.object({
      day_of_week: z.number().int().describe("0=Sunday(الأحد) 1=Monday(الاثنين) 2=Tuesday(الثلاثاء) 3=Wednesday(الأربعاء) 4=Thursday(الخميس) 5=Friday 6=Saturday"),
      period_number: z.number().int().describe("Period number 1..12 (الأولى=1, الثانية=2, …)"),
      start_time: z.string().describe("HH:MM 24h if written, else empty"),
      end_time: z.string().describe("HH:MM 24h if written, else empty"),
      classroom_name: z.string().describe("Class/section taught in this slot as written, e.g. '2/1' or 'ثاني أ'"),
      subject: z.string().describe("Subject name if written, else empty"),
      room: z.string().describe("Room/lab if written, else empty"),
      confidence: Confidence,
    }),
  ),
  notes: z.string().describe("Short Arabic note about problems. Empty if none."),
});
export type ScheduleExtraction = z.infer<typeof ScheduleExtraction>;

export type ExtractionKind = "roster" | "schedule";
export type ExtractionResult =
  | { kind: "roster"; data: RosterExtraction }
  | { kind: "schedule"; data: ScheduleExtraction };
