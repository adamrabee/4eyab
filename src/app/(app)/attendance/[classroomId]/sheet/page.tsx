import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DAY_NAMES, dayOfWeek, formatHijri, formatShortDate, isISODate } from "@/lib/dates";
import { Alert, ButtonLink } from "@/components/ui";
import { SheetToolbar, type SheetData } from "./toolbar";

export const metadata: Metadata = { title: "كشف الغائبين" };

export default async function SheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ classroomId: string }>;
  searchParams: Promise<{ date?: string; period?: string }>;
}) {
  const { classroomId } = await params;
  const sp = await searchParams;
  const period = Number(sp.period);
  if (!/^[0-9a-f-]{36}$/i.test(classroomId) || !isISODate(sp.date) || !(period >= 1 && period <= 12)) notFound();
  const date = sp.date;

  const supabase = await createClient();
  const [{ data: classroom }, { data: session }, { data: profile }] = await Promise.all([
    supabase.from("classrooms").select("name, grade, section").eq("id", classroomId).single(),
    supabase
      .from("attendance_sessions")
      .select("subject, attendance_records(status, minutes_late, student:students(full_name, sort_order))")
      .eq("classroom_id", classroomId)
      .eq("session_date", date)
      .eq("period_number", period)
      .maybeSingle(),
    supabase.from("profiles").select("full_name, school_name").single(),
  ]);
  if (!classroom) notFound();
  const back = `/attendance/${classroomId}?date=${date}&period=${period}`;

  if (!session) {
    return (
      <div className="space-y-4">
        <Alert tone="info">لم يُسجَّل حضور هذه الحصة بعد.</Alert>
        <ButtonLink href={back}>تسجيل الحضور</ButtonLink>
      </div>
    );
  }

  type R = { status: string; minutes_late: number | null; student: { full_name: string; sort_order: number } | { full_name: string; sort_order: number }[] | null };
  const recs = ((session.attendance_records ?? []) as R[])
    .map((r) => ({ ...r, student: Array.isArray(r.student) ? r.student[0] : r.student }))
    .filter((r) => r.student)
    .sort((a, b) => a.student!.sort_order - b.student!.sort_order || a.student!.full_name.localeCompare(b.student!.full_name, "ar"));
  const pick = (st: string) => recs.filter((r) => r.status === st).map((r) => ({ name: r.student!.full_name, minutes: r.minutes_late }));

  const data: SheetData = {
    school: profile?.school_name ?? "",
    classroom: classroom.name,
    grade: [classroom.grade, classroom.section].filter(Boolean).join(" / "),
    day: DAY_NAMES[dayOfWeek(date)],
    hijri: formatHijri(date),
    gregorian: formatShortDate(date),
    period,
    subject: session.subject,
    teacher: profile?.full_name ?? "",
    absent: pick("absent"),
    late: pick("late"),
    excused: pick("excused"),
    total: recs.length,
    fileName: `غياب_${classroom.name}_${date}_الحصة${period}`.replace(/[\\/:*?"<>|\s]+/g, "_"),
  };

  return (
    <>
      <SheetToolbar data={data} back={back} />
      <article className="sheet mx-auto max-w-[210mm] rounded-2xl border border-border bg-white p-6 text-[#111] print:max-w-none print:rounded-none print:border-0 print:p-0">
        {data.school && <p className="text-center text-sm">{data.school}</p>}
        <h1 className="mt-1 text-center text-2xl font-bold">كشف الطلاب الغائبين</h1>
        <p className="mb-5 text-center">{data.classroom}{data.grade ? ` — ${data.grade}` : ""}</p>
        <table className="mb-5 w-full border-collapse text-center [&_td]:border [&_td]:border-[#555] [&_td]:p-2 [&_th]:border [&_th]:border-[#555] [&_th]:p-2">
          <tbody>
            <tr><th className="w-[18%]">اليوم</th><td>{data.day}</td><th className="w-[18%]">التاريخ</th><td>{data.hijri}<br /><span className="text-xs">{data.gregorian} م</span></td></tr>
            <tr><th>الحصة</th><td>{data.period}</td><th>المادة</th><td>{data.subject || "—"}</td></tr>
          </tbody>
        </table>
        <SheetList title="اسم الطالب الغائب" rows={data.absent.map((a) => a.name)} empty="لا يوجد غياب في هذه الحصة" />
        <p className="mt-2 font-bold">عدد الغائبين: {data.absent.length} من {data.total}</p>
        {data.late.length > 0 && (
          <div className="mt-5">
            <SheetList title="الطلاب المتأخرون" rows={data.late.map((a) => (a.minutes ? `${a.name} (${a.minutes} دقيقة)` : a.name))} />
          </div>
        )}
        {data.excused.length > 0 && (
          <div className="mt-5">
            <SheetList title="الطلاب المستأذنون" rows={data.excused.map((a) => a.name)} />
          </div>
        )}
        <div className="mt-12 flex justify-between text-lg">
          <b>{data.teacher}</b>
          <span>التوقيع: ________________</span>
        </div>
      </article>
    </>
  );
}

function SheetList({ title, rows, empty }: { title: string; rows: string[]; empty?: string }) {
  return (
    <table className="w-full border-collapse [&_td]:h-9 [&_td]:border [&_td]:border-[#555] [&_th]:h-9 [&_th]:border [&_th]:border-[#555]">
      <thead><tr><th className="w-12">م</th><th>{title}</th></tr></thead>
      <tbody>
        {rows.length ? rows.map((n, i) => (
          <tr key={i}><td className="text-center">{i + 1}</td><td className="pe-3 ps-3 text-start">{n}</td></tr>
        )) : <tr><td colSpan={2} className="text-center">{empty}</td></tr>}
      </tbody>
    </table>
  );
}
