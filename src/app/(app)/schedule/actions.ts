"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type FormState = { error?: string; ok?: string } | undefined;

const time = z.union([z.literal(""), z.string().regex(/^\d{2}:\d{2}$/, "صيغة الوقت غير صحيحة")]);
const PeriodInput = z
  .object({
    id: z.union([z.literal(""), z.string().uuid()]).default(""),
    classroom_id: z.string().uuid("اختر الفصل"),
    day_of_week: z.coerce.number().int().min(0).max(6),
    period_number: z.coerce.number().int().min(1).max(12),
    start_time: time.default(""),
    end_time: time.default(""),
    subject: z.string().trim().max(80).default(""),
    room: z.string().trim().max(40).default(""),
  })
  .refine((v) => !v.start_time || !v.end_time || v.end_time > v.start_time, "وقت النهاية يجب أن يكون بعد البداية");

export async function savePeriod(_: FormState, form: FormData): Promise<FormState> {
  const parsed = PeriodInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { id, ...v } = parsed.data;
  const row = { ...v, start_time: v.start_time || null, end_time: v.end_time || null };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("schedule_periods").update(row).eq("id", id)
    : await supabase.from("schedule_periods").insert(row);
  if (error) {
    return { error: error.code === "23505" ? "لديك حصة أخرى في نفس اليوم ونفس رقم الحصة" : "تعذّر الحفظ" };
  }
  revalidatePath("/schedule");
  revalidatePath("/dashboard");
  return { ok: "تم الحفظ" };
}

export async function deletePeriod(id: string): Promise<FormState> {
  if (!z.string().uuid().safeParse(id).success) return { error: "طلب غير صالح" };
  const supabase = await createClient();
  const { error } = await supabase.from("schedule_periods").delete().eq("id", id);
  if (error) return { error: "تعذّر الحذف" };
  revalidatePath("/schedule");
  revalidatePath("/dashboard");
  return { ok: "تم الحذف" };
}
