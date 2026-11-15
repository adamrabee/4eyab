import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatShortDate } from "@/lib/dates";
import { resolveRange } from "@/lib/reports/range";
import { ButtonLink, Card, EmptyState, PageHeader, cx } from "@/components/ui";
import { ReportFilters, PrintButton } from "./filters";

export const metadata: Metadata = { title: "التقارير" };

type Row = { student_id: string; full_name: string; present: number; absent: number; late: number; excused: number; total: number; attendance_rate: number | null };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ classroom?: string; from?: string; to?: string; preset?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: classrooms } = await supabase.from("classrooms").select("id, name").eq("archived", false).order("name");
  if (!classrooms?.length) {
    return (
      <>
        <PageHeader title="التقارير" />
        <EmptyState title="لا توجد فصول بعد" action={<ButtonLink href="/scan">المسح الذكي</ButtonLink>} />
      </>
    );
  }
  const classroomId = classrooms.some((c) => c.id === sp.classroom) ? sp.classroom! : classrooms[0].id;
  const classroom = classrooms.find((c) => c.id === classroomId)!;
  const range = resolveRange(sp);

  const [{ data: rows }, { data: sessions }, { data: profile }] = await Promise.all([
    supabase.rpc("attendance_summary", { p_classroom_id: classroomId, p_from: range.from, p_to: range.to }),
    supabase
      .from("attendance_sessions")
      .select("id, session_date, period_number, subject, attendance_records(status)")
      .eq("classroom_id", classroomId)
      .gte("session_date", range.from)
      .lte("session_date", range.to)
      .order("session_date", { ascending: false })
      .order("period_number", { ascending: false }),
    supabase.from("profiles").select("full_name, school_name").single(),
  ]);

  const list = (rows ?? []) as Row[];
  const totals = list.reduce((t, r) => ({ absent: t.absent + r.absent, late: t.late + r.late, excused: t.excused + r.excused, total: t.total + r.total }), { absent: 0, late: 0, excused: 0, total: 0 });
  const overall = totals.total ? Math.round((1000 * (totals.total - totals.absent - totals.excused)) / totals.total) / 10 : null;
  const qs = new URLSearchParams({ classroom: classroomId, from: range.from, to: range.to }).toString();

  return (
    <>
      <PageHeader
        title="التقارير"
        actions={
          <>
            <ButtonLink href={`/api/reports/excel?${qs}`} variant="secondary" prefetch={false}>⬇ Excel</ButtonLink>
            <PrintButton />
          </>
        }
      />
      <ReportFilters classrooms={classrooms} classroomId={classroomId} range={range} />

      {/* printed header */}
      <div className="hidden print:block">
        {profile?.school_name && <p className="text-center text-sm">{profile.school_name}</p>}
        <h1 className="text-center text-2xl font-bold">تقرير الحضور والغياب — {classroom.name}</h1>
        <p className="mb-4 text-center text-sm">من {formatShortDate(range.from)} إلى {formatShortDate(range.to)} · {profile?.full_name}</p>
      </div>

      <div className="my-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="الحصص المسجّلة" value={sessions?.length ?? 0} />
        <Stat label="نسبة الحضور" value={overall === null ? "—" : `${overall}%`} />
        <Stat label="مرات الغياب" value={totals.absent} tone="text-absent" />
        <Stat label="التأخر / الاستئذان" value={`${totals.late} / ${totals.excused}`} />
      </div>

      {list.length === 0 ? (
        <EmptyState title="لا يوجد طلاب في هذا الفصل" />
      ) : (
        <Card className="overflow-x-auto p-0 sm:p-0">
          <table className="w-full min-w-[34rem] border-collapse text-sm">
            <thead className="bg-surface-2">
              <tr className="[&_th]:p-2 [&_th]:font-medium">
                <th className="w-10">م</th>
                <th className="text-start">الطالب</th>
                <th>غياب</th>
                <th>تأخر</th>
                <th>استئذان</th>
                <th>الحصص</th>
                <th>الحضور</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r, i) => {
                const rate = r.attendance_rate === null ? null : Number(r.attendance_rate);
                return (
                  <tr key={r.student_id} className="border-t border-border text-center [&_td]:p-2">
                    <td className="text-xs text-muted ltr-nums">{i + 1}</td>
                    <td className="text-start">
                      <Link href={`/reports/student/${r.student_id}?from=${range.from}&to=${range.to}`} className="hover:text-primary hover:underline">
                        {r.full_name}
                      </Link>
                    </td>
                    <td className={cx(r.absent > 0 && "font-bold text-absent")}>{r.absent}</td>
                    <td className={cx(r.late > 0 && "text-late")}>{r.late}</td>
                    <td className={cx(r.excused > 0 && "text-excused")}>{r.excused}</td>
                    <td className="text-muted">{r.total}</td>
                    <td>
                      {rate === null ? "—" : (
                        <span className={cx("rounded-full px-2 py-0.5 text-xs font-medium", rate >= 90 ? "bg-present-soft text-present" : rate >= 75 ? "bg-late-soft text-late" : "bg-absent-soft text-absent")}>
                          {rate}%
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      <p className="mt-2 text-xs text-muted">نسبة الحضور = (حاضر + متأخر) ÷ عدد الحصص المسجّلة للطالب.</p>

      <section className="mt-8 print:break-before-page">
        <h2 className="mb-3 font-bold">سجل الحصص</h2>
        {sessions?.length ? (
          <Card className="divide-y divide-border p-0 sm:p-0">
            {sessions.map((s) => {
              const recs = (s.attendance_records ?? []) as { status: string }[];
              const n = (st: string) => recs.filter((r) => r.status === st).length;
              return (
                <Link key={s.id} href={`/attendance/${classroomId}?date=${s.session_date}&period=${s.period_number}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2">
                  <span>
                    <span className="font-medium">{formatShortDate(s.session_date)}</span>
                    <span className="ms-2 text-sm text-muted">الحصة {s.period_number}{s.subject ? ` · ${s.subject}` : ""}</span>
                  </span>
                  <span className="flex gap-1 text-xs">
                    <span className="rounded-full bg-absent-soft px-2 py-0.5 text-absent">غ {n("absent")}</span>
                    {n("late") > 0 && <span className="rounded-full bg-late-soft px-2 py-0.5 text-late">ت {n("late")}</span>}
                    {n("excused") > 0 && <span className="rounded-full bg-excused-soft px-2 py-0.5 text-excused">س {n("excused")}</span>}
                  </span>
                </Link>
              );
            })}
          </Card>
        ) : (
          <p className="text-sm text-muted">لا توجد حصص مسجّلة في هذه الفترة.</p>
        )}
      </section>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <Card className="p-3 sm:p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={cx("mt-1 text-xl font-bold", tone)}>{value}</p>
    </Card>
  );
}
