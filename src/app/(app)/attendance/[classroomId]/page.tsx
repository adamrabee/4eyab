import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DAY_NAMES, addDays, dayOfWeek, formatHijri, formatShortDate, isISODate, todayISO } from "@/lib/dates";
import { Alert, ButtonLink, EmptyState } from "@/components/ui";
import { Taker, type Status } from "./taker";

export const metadata: Metadata = { title: "تسجيل الحضور" };

export default async function TakeAttendance({
  params,
  searchParams,
}: {
  params: Promise<{ classroomId: string }>;
  searchParams: Promise<{ date?: string; period?: string }>;
}) {
  const { classroomId } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(classroomId)) notFound();
  const today = todayISO();
  const date = isISODate(sp.date) ? sp.date : today;
  const dow = dayOfWeek(date);

  const supabase = await createClient();
  const [{ data: classroom }, { data: slots }] = await Promise.all([
    supabase.from("classrooms").select("id, name, grade, section").eq("id", classroomId).single(),
    supabase.from("schedule_periods").select("period_number, subject").eq("classroom_id", classroomId).eq("day_of_week", dow).order("period_number"),
  ]);
  if (!classroom) notFound();

  const requested = Number(sp.period);
  const period = Number.isInteger(requested) && requested >= 1 && requested <= 12 ? requested : (slots?.[0]?.period_number ?? 1);

  const [{ data: students }, { data: sessions }] = await Promise.all([
    supabase
      .from("students")
      .select("id, full_name, student_number, active")
      .eq("classroom_id", classroomId)
      .order("sort_order")
      .order("full_name"),
    supabase
      .from("attendance_sessions")
      .select("id, period_number, subject, attendance_records(student_id, status, minutes_late, note)")
      .eq("classroom_id", classroomId)
      .eq("session_date", date)
      .order("period_number"),
  ]);

  const session = sessions?.find((s) => s.period_number === period) ?? null;
  const previous = [...(sessions ?? [])].reverse().find((s) => s.period_number < period) ?? null;
  const recorded = new Set((session?.attendance_records ?? []).map((r) => r.student_id));
  // active students, plus removed ones that already have a record in this session
  const roster = (students ?? []).filter((s) => s.active || recorded.has(s.id));
  const subject = session?.subject || slots?.find((s) => s.period_number === period)?.subject || "";

  const toMap = (recs: { student_id: string; status: string; minutes_late: number | null; note: string }[] | undefined) =>
    Object.fromEntries((recs ?? []).map((r) => [r.student_id, { status: r.status as Status, minutes_late: r.minutes_late, note: r.note }]));

  const future = date > addDays(today, 1);

  return (
    <>
      <div className="mb-4">
        <ButtonLink href={`/attendance?date=${date}`} variant="ghost" className="-ms-3 h-9 text-muted">→ التحضير</ButtonLink>
        <h1 className="text-xl font-bold sm:text-2xl">{classroom.name}</h1>
        <p className="mt-1 text-sm text-muted">
          {DAY_NAMES[dow]} · {formatShortDate(date)} · {formatHijri(date)}
        </p>
      </div>

      {future ? (
        <Alert tone="warning">لا يمكن تسجيل الحضور ليوم قادم.</Alert>
      ) : roster.length === 0 ? (
        <EmptyState
          title="لا يوجد طلاب في هذا الفصل"
          body="أضف الطلاب أولًا ثم ارجع لتسجيل الحضور."
          action={<ButtonLink href={`/classrooms/${classroom.id}`}>إدارة الفصل</ButtonLink>}
        />
      ) : (
        <Taker
          key={`${date}:${period}`}
          classroomId={classroom.id}
          date={date}
          period={period}
          initialSubject={subject}
          slots={(slots ?? []).map((s) => ({ period: s.period_number, subject: s.subject }))}
          takenPeriods={(sessions ?? []).map((s) => s.period_number)}
          students={roster.map((s) => ({ id: s.id, name: s.full_name, removed: !s.active }))}
          initial={toMap(session?.attendance_records)}
          sessionId={session?.id ?? null}
          previous={previous ? { period: previous.period_number, records: toMap(previous.attendance_records) } : null}
        />
      )}
    </>
  );
}
