import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DAY_NAMES, dayOfWeek, formatShortDate } from "@/lib/dates";
import { resolveRange, STATUS_AR } from "@/lib/reports/range";
import { ButtonLink, Card, PageHeader, cx } from "@/components/ui";

export const metadata: Metadata = { title: "سجل الطالب" };

const TONE: Record<string, string> = { absent: "bg-absent-soft text-absent", late: "bg-late-soft text-late", excused: "bg-excused-soft text-excused", present: "bg-present-soft text-present" };

export default async function StudentHistory({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const range = resolveRange(await searchParams);
  const supabase = await createClient();
  const { data: student } = await supabase
    .from("students")
    .select("id, full_name, student_number, guardian_phone, classroom_id, classroom:classrooms(name)")
    .eq("id", id)
    .single();
  if (!student) notFound();
  const { data: recs } = await supabase
    .from("attendance_records")
    .select("status, minutes_late, note, session:attendance_sessions!inner(session_date, period_number, subject)")
    .eq("student_id", id)
    .gte("session.session_date", range.from)
    .lte("session.session_date", range.to);

  type Rec = { status: string; minutes_late: number | null; note: string; session: { session_date: string; period_number: number; subject: string } };
  const list = ((recs ?? []) as unknown as Rec[])
    .map((r) => ({ ...r, session: Array.isArray(r.session) ? r.session[0] : r.session }))
    .sort((a, b) => b.session.session_date.localeCompare(a.session.session_date) || b.session.period_number - a.session.period_number);
  const count = (s: string) => list.filter((r) => r.status === s).length;
  const notPresent = list.filter((r) => r.status !== "present");
  const cls = Array.isArray(student.classroom) ? student.classroom[0] : student.classroom;

  return (
    <>
      <PageHeader
        title={student.full_name}
        subtitle={`${cls?.name ?? ""} · من ${formatShortDate(range.from)} إلى ${formatShortDate(range.to)}`}
        actions={<ButtonLink href={`/reports?classroom=${student.classroom_id}&preset=custom&from=${range.from}&to=${range.to}`} variant="secondary">رجوع للتقرير</ButtonLink>}
      />
      <div className="mb-4 grid grid-cols-4 gap-2 text-center">
        {(["present", "absent", "late", "excused"] as const).map((s) => (
          <Card key={s} className="p-3 sm:p-3">
            <p className="text-xs text-muted">{STATUS_AR[s]}</p>
            <p className="text-xl font-bold">{count(s)}</p>
          </Card>
        ))}
      </div>
      {student.guardian_phone && (
        <p className="mb-4 text-sm">
          جوال ولي الأمر: <a className="font-medium text-primary ltr-nums" href={`tel:${student.guardian_phone}`}>{student.guardian_phone}</a>
        </p>
      )}
      <h2 className="mb-2 font-bold">الغياب والتأخر والاستئذان</h2>
      {notPresent.length ? (
        <Card className="divide-y divide-border p-0 sm:p-0">
          {notPresent.map((r, i) => (
            <div key={i} className="flex items-center justify-between gap-3 px-4 py-3">
              <span>
                <span className="font-medium">{DAY_NAMES[dayOfWeek(r.session.session_date)]} {formatShortDate(r.session.session_date)}</span>
                <span className="ms-2 text-sm text-muted">الحصة {r.session.period_number}{r.session.subject ? ` · ${r.session.subject}` : ""}</span>
                {r.status === "late" && r.minutes_late ? <span className="ms-2 text-xs text-muted">({r.minutes_late} دقيقة)</span> : null}
              </span>
              <span className={cx("rounded-full px-2.5 py-0.5 text-xs font-medium", TONE[r.status])}>{STATUS_AR[r.status as keyof typeof STATUS_AR]}</span>
            </div>
          ))}
        </Card>
      ) : (
        <p className="text-sm text-muted">لا يوجد غياب أو تأخر في هذه الفترة.</p>
      )}
    </>
  );
}
