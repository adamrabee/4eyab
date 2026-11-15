import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DAY_NAMES, dayOfWeek, formatDateAr, formatTime, todayISO } from "@/lib/dates";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "الرئيسية" };

export default async function Dashboard() {
  const supabase = await createClient();
  const today = todayISO();
  const dow = dayOfWeek(today);

  const [{ data: profile }, { count: classCount }, { count: studentCount }, { data: periods }, { data: sessions }] =
    await Promise.all([
      supabase.from("profiles").select("full_name").single(),
      supabase.from("classrooms").select("id", { count: "exact", head: true }).eq("archived", false),
      supabase.from("students").select("id", { count: "exact", head: true }).eq("active", true),
      supabase
        .from("schedule_periods")
        .select("id, period_number, start_time, end_time, subject, classroom:classrooms(id, name)")
        .eq("day_of_week", dow)
        .order("period_number"),
      supabase.from("attendance_sessions").select("classroom_id, period_number").eq("session_date", today),
    ]);

  const taken = new Set((sessions ?? []).map((s) => `${s.classroom_id}:${s.period_number}`));
  // skip honorifics like "أ." / "د." / "الأستاذ" when greeting
  const TITLES = /^(أ\.?|ا\.|د\.?|م\.|الأستاذ|الأستاذة|الاستاذ|الاستاذه|المعلم|المعلمة|الدكتور|الدكتورة)$/;
  const firstName = (profile?.full_name ?? "").split(/\s+/).find((w: string) => w && !TITLES.test(w)) ?? "";

  if (!classCount) {
    return (
      <>
        <PageHeader title={`أهلًا${firstName ? ` ${firstName}` : ""} 👋`} subtitle={formatDateAr(today)} />
        <EmptyState
          title="لنبدأ بإعداد فصولك"
          body="صوّر كشف أسماء الطلاب أو جدولك الأسبوعي، وسيستخرج الذكاء الاصطناعي البيانات لتراجعها وتعتمدها."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <ButtonLink href="/scan">ابدأ المسح الذكي</ButtonLink>
              <ButtonLink href="/classrooms" variant="secondary">
                أضف فصلًا يدويًا
              </ButtonLink>
            </div>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title={`أهلًا${firstName ? ` ${firstName}` : ""} 👋`} subtitle={formatDateAr(today)} />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-muted">الفصول</p>
          <p className="mt-1 text-2xl font-bold">{classCount}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">الطلاب</p>
          <p className="mt-1 text-2xl font-bold">{studentCount ?? 0}</p>
        </Card>
        <Card className="col-span-2 sm:col-span-1">
          <p className="text-sm text-muted">حصص اليوم</p>
          <p className="mt-1 text-2xl font-bold">
            {taken.size} / {periods?.length ?? 0}
          </p>
        </Card>
      </div>

      <h2 className="mb-3 font-bold">جدول {DAY_NAMES[dow]}</h2>
      {periods && periods.length > 0 ? (
        <ul className="space-y-2">
          {periods.map((p) => {
            const cls = Array.isArray(p.classroom) ? p.classroom[0] : p.classroom;
            const done = cls && taken.has(`${cls.id}:${p.period_number}`);
            return (
              <li key={p.id}>
                <Link
                  href={cls ? `/attendance/${cls.id}?date=${today}&period=${p.period_number}` : "#"}
                  className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 hover:border-primary"
                >
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-soft font-bold text-primary">
                    {p.period_number}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{cls?.name ?? "—"}</span>
                    <span className="block truncate text-xs text-muted">
                      {p.subject}
                      {p.start_time && <span className="ltr-nums"> · {formatTime(p.start_time)}–{formatTime(p.end_time)}</span>}
                    </span>
                  </span>
                  <span
                    className={
                      done
                        ? "rounded-full bg-present-soft px-2.5 py-1 text-xs font-medium text-present"
                        : "rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted"
                    }
                  >
                    {done ? "تم التحضير" : "لم يُحضَّر"}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          title="لا توجد حصص مسجّلة لهذا اليوم"
          body="أضف جدولك الأسبوعي بتصويره أو إدخاله يدويًا لتظهر حصصك هنا تلقائيًا."
          action={<ButtonLink href="/schedule" variant="secondary">إدارة الجدول</ButtonLink>}
        />
      )}
    </>
  );
}
