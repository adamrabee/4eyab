import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  DAY_NAMES, SCHOOL_DAYS, addDays, dayOfWeek, formatHijri, formatShortDate, formatTime, isISODate, todayISO, weekStart,
} from "@/lib/dates";
import { ButtonLink, Card, EmptyState, PageHeader, cx } from "@/components/ui";
import { DatePicker, OffSchedulePicker } from "./hub-client";

export const metadata: Metadata = { title: "التحضير" };

type Rec = { status: string };

export default async function AttendanceHub({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const sp = await searchParams;
  const today = todayISO();
  const date = isISODate(sp.date) ? sp.date : today;
  const week = weekStart(date);
  const dow = dayOfWeek(date);

  const supabase = await createClient();
  const [{ data: periods }, { data: sessions }, { data: classrooms }] = await Promise.all([
    supabase
      .from("schedule_periods")
      .select("id, period_number, start_time, end_time, subject, classroom_id, classroom:classrooms(name, archived)")
      .eq("day_of_week", dow)
      .order("period_number"),
    supabase
      .from("attendance_sessions")
      .select("id, classroom_id, period_number, subject, classroom:classrooms(name), attendance_records(status)")
      .eq("session_date", date)
      .order("period_number"),
    supabase.from("classrooms").select("id, name").eq("archived", false).order("name"),
  ]);

  const one = <T,>(v: T | T[] | null) => (Array.isArray(v) ? v[0] : v);
  const bySlot = new Map((sessions ?? []).map((s) => [`${s.classroom_id}:${s.period_number}`, s]));
  const scheduled = (periods ?? []).filter((p) => !one(p.classroom)?.archived);
  const scheduledKeys = new Set(scheduled.map((p) => `${p.classroom_id}:${p.period_number}`));
  const extra = (sessions ?? []).filter((s) => !scheduledKeys.has(`${s.classroom_id}:${s.period_number}`));

  const counts = (recs: Rec[] | null | undefined) => {
    const c = { absent: 0, late: 0, excused: 0 };
    for (const r of recs ?? []) if (r.status in c) c[r.status as keyof typeof c]++;
    return c;
  };

  return (
    <>
      <PageHeader title="التحضير" subtitle={<span>{DAY_NAMES[dow]} · {formatShortDate(date)} · {formatHijri(date)}</span>} />

      {/* week navigation — same flow as the original sheet: week → day → period */}
      <div className="mb-3 flex items-center gap-2">
        <ButtonLink href={`/attendance?date=${addDays(week, -7)}`} variant="secondary" className="h-10 px-3" aria-label="الأسبوع السابق">→</ButtonLink>
        <DatePicker value={date} max={addDays(today, 1)} />
        <ButtonLink href={`/attendance?date=${addDays(week, 7)}`} variant="secondary" className="h-10 px-3" aria-label="الأسبوع التالي">←</ButtonLink>
        {date !== today && <ButtonLink href="/attendance" variant="ghost" className="h-10">اليوم</ButtonLink>}
      </div>
      <nav className="mb-5 grid grid-cols-5 overflow-hidden rounded-xl border border-border bg-surface" aria-label="أيام الأسبوع">
        {SCHOOL_DAYS.map((d) => {
          const dDate = addDays(week, d);
          const on = dDate === date;
          return (
            <Link
              key={d}
              href={`/attendance?date=${dDate}`}
              aria-current={on ? "date" : undefined}
              className={cx("border-s border-border py-2 text-center first:border-s-0", on ? "bg-primary text-on-primary" : "hover:bg-surface-2")}
            >
              <span className="block text-sm font-medium">{DAY_NAMES[d]}</span>
              <span className={cx("block text-xs ltr-nums", on ? "opacity-90" : "text-muted")}>{dDate.slice(8)}/{dDate.slice(5, 7)}</span>
            </Link>
          );
        })}
      </nav>

      {!classrooms?.length ? (
        <EmptyState title="لا توجد فصول بعد" body="أضف فصولك أولًا بمسح كشف الأسماء." action={<ButtonLink href="/scan">المسح الذكي</ButtonLink>} />
      ) : (
        <>
          {scheduled.length > 0 ? (
            <ul className="grid gap-3 sm:grid-cols-2">
              {scheduled.map((p) => {
                const s = bySlot.get(`${p.classroom_id}:${p.period_number}`);
                const c = counts(s?.attendance_records as Rec[] | undefined);
                return (
                  <li key={p.id}>
                    <PeriodCard
                      href={`/attendance/${p.classroom_id}?date=${date}&period=${p.period_number}`}
                      period={p.period_number}
                      title={one(p.classroom)?.name ?? "—"}
                      subtitle={[p.subject, p.start_time ? `${formatTime(p.start_time)}–${formatTime(p.end_time)}` : ""].filter(Boolean).join(" · ")}
                      taken={Boolean(s)}
                      counts={c}
                    />
                  </li>
                );
              })}
            </ul>
          ) : (
            <Card className="text-center text-sm text-muted">
              لا توجد حصص في جدولك يوم {DAY_NAMES[dow]}.{" "}
              <Link href="/schedule" className="font-medium text-primary">إدارة الجدول</Link>
            </Card>
          )}

          {extra.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-2 text-sm font-bold text-muted">حصص مسجّلة خارج الجدول</h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {extra.map((s) => (
                  <li key={s.id}>
                    <PeriodCard
                      href={`/attendance/${s.classroom_id}?date=${date}&period=${s.period_number}`}
                      period={s.period_number}
                      title={one(s.classroom)?.name ?? "—"}
                      subtitle={s.subject}
                      taken
                      counts={counts(s.attendance_records as Rec[])}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <OffSchedulePicker classrooms={classrooms} date={date} />
        </>
      )}
    </>
  );
}

function PeriodCard({ href, period, title, subtitle, taken, counts }: {
  href: string; period: number; title: string; subtitle?: string; taken: boolean; counts: { absent: number; late: number; excused: number };
}) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 hover:border-primary">
      <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary-soft text-center leading-tight text-primary">
        <span className="text-[10px]">الحصة</span>
        <span className="block text-lg font-bold">{period}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold">{title}</span>
        {subtitle && <span className="block truncate text-xs text-muted">{subtitle}</span>}
        <span className="mt-1 flex flex-wrap gap-1 text-xs">
          {!taken ? (
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-muted">لم يُحضَّر</span>
          ) : counts.absent + counts.late + counts.excused === 0 ? (
            <span className="rounded-full bg-present-soft px-2 py-0.5 text-present">لا يوجد غياب</span>
          ) : (
            <>
              {counts.absent > 0 && <span className="rounded-full bg-absent-soft px-2 py-0.5 text-absent">غياب: {counts.absent}</span>}
              {counts.late > 0 && <span className="rounded-full bg-late-soft px-2 py-0.5 text-late">تأخر: {counts.late}</span>}
              {counts.excused > 0 && <span className="rounded-full bg-excused-soft px-2 py-0.5 text-excused">استئذان: {counts.excused}</span>}
            </>
          )}
        </span>
      </span>
    </Link>
  );
}
