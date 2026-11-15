"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type FormState = { error?: string; ok?: string } | undefined;
const uuid = z.string().uuid();

const ClassroomInput = z.object({
  name: z.string().trim().min(1, "أدخل اسم الفصل").max(80),
  grade: z.string().trim().max(60).default(""),
  section: z.string().trim().max(30).default(""),
  academic_year: z.string().trim().max(20).default(""),
});

const StudentInput = z.object({
  full_name: z.string().trim().min(2, "أدخل اسم الطالب").max(150),
  student_number: z.string().trim().max(40).default(""),
  guardian_phone: z.string().trim().max(30).regex(/^[\d+\-\s()]*$/, "رقم الجوال غير صحيح").default(""),
  notes: z.string().trim().max(1000).default(""),
});

export async function createClassroom(_: FormState, form: FormData): Promise<FormState> {
  const parsed = ClassroomInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.from("classrooms").insert(parsed.data).select("id").single();
  if (error || !data) return { error: "تعذّر إنشاء الفصل" };
  revalidatePath("/", "layout");
  redirect(`/classrooms/${data.id}`);
}

export async function updateClassroom(id: string, _: FormState, form: FormData): Promise<FormState> {
  const parsed = ClassroomInput.safeParse(Object.fromEntries(form));
  if (!uuid.safeParse(id).success) return { error: "طلب غير صالح" };
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("classrooms").update(parsed.data).eq("id", id);
  if (error) return { error: "تعذّر الحفظ" };
  revalidatePath(`/classrooms/${id}`);
  return { ok: "تم الحفظ" };
}

export async function setClassroomArchived(id: string, archived: boolean) {
  if (!uuid.safeParse(id).success) return;
  const supabase = await createClient();
  await supabase.from("classrooms").update({ archived }).eq("id", id);
  revalidatePath("/", "layout");
  redirect("/classrooms");
}

export async function deleteClassroom(id: string) {
  if (!uuid.safeParse(id).success) return;
  const supabase = await createClient();
  await supabase.from("classrooms").delete().eq("id", id);
  revalidatePath("/", "layout");
  redirect("/classrooms");
}

export async function addStudent(classroomId: string, _: FormState, form: FormData): Promise<FormState> {
  if (!uuid.safeParse(classroomId).success) return { error: "طلب غير صالح" };
  const parsed = StudentInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data: last } = await supabase
    .from("students")
    .select("sort_order")
    .eq("classroom_id", classroomId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase
    .from("students")
    .insert({ ...parsed.data, classroom_id: classroomId, sort_order: (last?.sort_order ?? 0) + 1 });
  if (error) return { error: "تعذّر إضافة الطالب" };
  revalidatePath(`/classrooms/${classroomId}`);
  return { ok: `أُضيف ${parsed.data.full_name}` };
}

export async function updateStudent(id: string, classroomId: string, _: FormState, form: FormData): Promise<FormState> {
  if (!uuid.safeParse(id).success) return { error: "طلب غير صالح" };
  const parsed = StudentInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("students").update(parsed.data).eq("id", id);
  if (error) return { error: "تعذّر الحفظ" };
  revalidatePath(`/classrooms/${classroomId}`);
  return { ok: "تم الحفظ" };
}

/** Soft-remove: keeps the student's attendance history intact. */
export async function setStudentActive(id: string, classroomId: string, active: boolean) {
  if (!uuid.safeParse(id).success) return;
  const supabase = await createClient();
  await supabase.from("students").update({ active }).eq("id", id);
  revalidatePath(`/classrooms/${classroomId}`);
}

export async function moveStudent(id: string, classroomId: string, direction: "up" | "down") {
  if (!uuid.safeParse(id).success) return;
  const supabase = await createClient();
  const { data: list } = await supabase
    .from("students")
    .select("id, sort_order")
    .eq("classroom_id", classroomId)
    .eq("active", true)
    .order("sort_order")
    .order("full_name");
  if (!list) return;
  const i = list.findIndex((s) => s.id === id);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  // renumber, touching only rows whose position actually changed
  await Promise.all(
    list
      .map((s, idx) => ({ ...s, next: idx + 1 }))
      .filter((s) => s.sort_order !== s.next)
      .map((s) => supabase.from("students").update({ sort_order: s.next }).eq("id", s.id)),
  );
  revalidatePath(`/classrooms/${classroomId}`);
}
