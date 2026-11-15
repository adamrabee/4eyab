"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { error?: string } | undefined;

const uuid = z.string().uuid();
const time = z.union([z.literal(""), z.string().regex(/^\d{2}:\d{2}$/)]);

const RosterApproval = z.object({
  jobId: uuid,
  target: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("existing"), classroomId: uuid }),
    z.object({
      mode: z.literal("new"),
      name: z.string().trim().min(1, "أدخل اسم الفصل").max(80),
      grade: z.string().trim().max(60).default(""),
      section: z.string().trim().max(30).default(""),
    }),
  ]),
  students: z
    .array(z.object({ full_name: z.string().trim().max(150), student_number: z.string().trim().max(40).default("") }))
    .max(200),
});

const ScheduleApproval = z.object({
  jobId: uuid,
  replaceExisting: z.boolean(),
  entries: z
    .array(
      z.object({
        day_of_week: z.number().int().min(0).max(6),
        period_number: z.number().int().min(1).max(12),
        start_time: time,
        end_time: time,
        subject: z.string().trim().max(80),
        room: z.string().trim().max(40).default(""),
        classroom_id: uuid.optional(),
        classroom_name: z.string().trim().max(80).optional(),
      }),
    )
    .max(84),
});

function dbError(message: string) {
  if (/not awaiting review/.test(message)) return "تمت معالجة هذا المسح مسبقًا";
  if (/not found/.test(message)) return "العنصر غير موجود";
  if (/duplicate key|unique/.test(message)) return "يوجد تعارض: حصتان في نفس اليوم ونفس رقم الحصة";
  return "تعذّر الحفظ، حاول مرة أخرى";
}

export async function approveRoster(payload: unknown): Promise<ActionResult> {
  const parsed = RosterApproval.safeParse(payload);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { jobId, target, students } = parsed.data;
  const clean = students.filter((s) => s.full_name.length > 0);
  if (clean.length === 0) return { error: "لا يوجد طلاب للحفظ" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("approve_roster_extraction", {
    job_id: jobId,
    students: clean,
    target_classroom_id: target.mode === "existing" ? target.classroomId : null,
    new_classroom: target.mode === "new" ? { name: target.name, grade: target.grade, section: target.section } : null,
  });
  if (error) return { error: dbError(error.message) };
  revalidatePath("/", "layout");
  const r = data as { classroom_id: string; inserted: number; skipped: number };
  redirect(`/classrooms/${r.classroom_id}?added=${r.inserted}&skipped=${r.skipped}`);
}

export async function approveSchedule(payload: unknown): Promise<ActionResult> {
  const parsed = ScheduleApproval.safeParse(payload);
  if (!parsed.success) return { error: "بيانات الجدول غير صالحة: تحقق من الأيام وأرقام الحصص والأوقات" };
  const { jobId, replaceExisting, entries } = parsed.data;
  if (entries.length === 0) return { error: "لا توجد حصص للحفظ" };
  const slots = new Set<string>();
  for (const e of entries) {
    if (!e.classroom_id && !e.classroom_name) return { error: "حدّد الفصل لكل حصة" };
    if (e.start_time && e.end_time && e.end_time <= e.start_time) return { error: "وقت نهاية الحصة يجب أن يكون بعد بدايتها" };
    const k = `${e.day_of_week}:${e.period_number}`;
    if (slots.has(k)) return { error: "يوجد حصتان في نفس اليوم ونفس رقم الحصة" };
    slots.add(k);
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_schedule_extraction", {
    job_id: jobId,
    entries,
    replace_existing: replaceExisting,
  });
  if (error) return { error: dbError(error.message) };
  revalidatePath("/", "layout");
  redirect("/schedule?saved=1");
}

export async function rejectJob(jobId: string): Promise<ActionResult> {
  if (!uuid.safeParse(jobId).success) return { error: "طلب غير صالح" };
  const supabase = await createClient();
  const { error } = await supabase.from("extraction_jobs").update({ status: "rejected" }).eq("id", jobId);
  if (error) return { error: "تعذّر الرفض" };
  revalidatePath("/scan");
  redirect("/scan");
}
