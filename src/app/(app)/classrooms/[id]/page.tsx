import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/dates";
import { Alert, ButtonLink, Card, PageHeader } from "@/components/ui";
import { AddStudentForm, ClassroomSettings, StudentRow, InactiveStudentRow } from "./client";

export const metadata: Metadata = { title: "الفصل" };

export default async function ClassroomPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ added?: string; skipped?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: c }, { data: students }] = await Promise.all([
    supabase.from("classrooms").select("*").eq("id", id).single(),
    supabase
      .from("students")
      .select("id, full_name, student_number, guardian_phone, notes, active, sort_order")
      .eq("classroom_id", id)
      .order("sort_order")
      .order("full_name"),
  ]);
  if (!c) notFound();
  const active = (students ?? []).filter((s) => s.active);
  const inactive = (students ?? []).filter((s) => !s.active);

  return (
    <>
      <PageHeader
        title={c.name}
        subtitle={[c.grade, c.section, c.academic_year].filter(Boolean).join(" · ") || `${active.length} طالب`}
        actions={
          active.length > 0 ? (
            <>
              <ButtonLink href={`/attendance/${c.id}?date=${todayISO()}`}>تسجيل الحضور</ButtonLink>
              <ButtonLink href={`/reports?classroom=${c.id}`} variant="secondary">التقرير</ButtonLink>
            </>
          ) : undefined
        }
      />
      {sp.added !== undefined && (
        <div className="mb-4">
          <Alert tone="success">
            تمت إضافة {sp.added} طالب{Number(sp.skipped) > 0 ? `، وتم تجاهل ${sp.skipped} اسم مكرر موجود مسبقًا` : ""}.
          </Alert>
        </div>
      )}
      {c.archived && <div className="mb-4"><Alert tone="info">هذا الفصل مؤرشف.</Alert></div>}

      <Card className="p-0 sm:p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-bold">الطلاب ({active.length})</h2>
          <ButtonLink href="/scan?kind=roster" variant="ghost" className="h-9">📷 إضافة من صورة</ButtonLink>
        </div>
        {active.length > 0 ? (
          <ol className="divide-y divide-border">
            {active.map((s, i) => (
              <StudentRow key={s.id} index={i} student={s} classroomId={c.id} isFirst={i === 0} isLast={i === active.length - 1} />
            ))}
          </ol>
        ) : (
          <p className="px-4 py-6 text-center text-sm text-muted">لا يوجد طلاب بعد.</p>
        )}
        <div className="border-t border-border p-4">
          <AddStudentForm classroomId={c.id} />
        </div>
      </Card>

      {inactive.length > 0 && (
        <details className="mt-4 rounded-2xl border border-border bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">طلاب محذوفون من الفصل ({inactive.length})</summary>
          <ul className="divide-y divide-border border-t border-border">
            {inactive.map((s) => (
              <InactiveStudentRow key={s.id} student={s} classroomId={c.id} />
            ))}
          </ul>
        </details>
      )}

      <ClassroomSettings classroom={c} />
    </>
  );
}
