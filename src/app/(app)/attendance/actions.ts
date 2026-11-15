"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isISODate } from "@/lib/dates";

const Payload = z.object({
  classroomId: z.string().uuid(),
  date: z.string().refine(isISODate, "تاريخ غير صالح"),
  period: z.number().int().min(1).max(12),
  subject: z.string().trim().max(80).default(""),
  records: z
    .array(
      z.object({
        student_id: z.string().uuid(),
        status: z.enum(["present", "absent", "late", "excused"]),
        minutes_late: z.number().int().min(0).max(600).nullable().optional(),
        note: z.string().trim().max(500).default(""),
      }),
    )
    .max(200),
});

export type SaveResult = { ok: true; sessionId: string } | { ok: false; error: string };

export async function saveAttendance(payload: unknown): Promise<SaveResult> {
  const parsed = Payload.safeParse(payload);
  if (!parsed.success) return { ok: false, error: "بيانات غير صالحة" };
  const { classroomId, date, period, subject, records } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_attendance", {
    p_classroom_id: classroomId,
    p_session_date: date,
    p_period_number: period,
    p_records: records,
    p_subject: subject,
    p_notes: "",
  });
  if (error || !data) {
    return { ok: false, error: /future/.test(error?.message ?? "") ? "لا يمكن تسجيل حضور ليوم قادم" : "تعذّر الحفظ، تحقق من الاتصال" };
  }
  revalidatePath("/dashboard");
  revalidatePath("/attendance");
  return { ok: true, sessionId: data as string };
}

/** Delete a whole session (e.g. recorded for the wrong period). */
export async function deleteSession(sessionId: string): Promise<{ error?: string }> {
  if (!z.string().uuid().safeParse(sessionId).success) return { error: "طلب غير صالح" };
  const supabase = await createClient();
  const { error } = await supabase.from("attendance_sessions").delete().eq("id", sessionId);
  if (error) return { error: "تعذّر الحذف" };
  revalidatePath("/dashboard");
  revalidatePath("/attendance");
  return {};
}
