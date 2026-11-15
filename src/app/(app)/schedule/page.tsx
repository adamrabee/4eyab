import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DAY_NAMES, SCHOOL_DAYS, formatTime } from "@/lib/dates";
import { Alert, ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { PeriodEditor } from "./period-editor";

export const metadata: Metadata = { title: "الجدول الأسبوعي" };

export type Period = {
  id: string;
  classroom_id: string;
  day_of_week: number;
  period_number: number;
  start_time: string | null;
  end_time: string | null;
  subject: string;
  room: string;
};

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const { saved } = await searchParams;
  const supabase = await createClient();
  const [{ data: periods }, { data: classrooms }] = await Promise.all([
    supabase.from("schedule_periods").select("id, classroom_id, day_of_week, period_number, start_time, end_time, subject, room").order("period_number"),
    supabase.from("classrooms").select("id, name").eq("archived", false).order("name"),
  ]);
  const names = new Map((classrooms ?? []).map((c) => [c.id, c.name]));
  const ps = (periods ?? []) as Period[];
  const days = [...new Set([...SCHOOL_DAYS, ...ps.map((p) => p.day_of_week)])].sort();
  const maxPeriod = Math.max(7, ...ps.map((p) => p.period_number));
  const at = (d: number, n: number) => ps.find((p) => p.day_of_week === d && p.period_number === n);

  return (
    <>
      <PageHeader
        title="الجدول الأسبوعي"
        actions={<ButtonLink href="/scan?kind=schedule">📷 مسح الجدول</ButtonLink>}
      />
      {saved && <div className="mb-4"><Alert tone="success">تم حفظ الجدول.</Alert></div>}

      {!classrooms?.length ? (
        <EmptyState
          title="أضف فصولك أولًا"
          body="يمكنك مسح الجدول مباشرة وستُنشأ الفصول تلقائيًا، أو أنشئ الفصول ثم أضف الحصص يدويًا."
          action={<ButtonLink href="/scan?kind=schedule">مسح الجدول</ButtonLink>}
        />
      ) : (
        <>
          {/* desktop grid */}
          <div className="hidden overflow-x-auto rounded-2xl border border-border bg-surface md:block">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-surface-2">
                  <th className="w-20 p-2 text-muted">الحصة</th>
                  {days.map((d) => (
                    <th key={d} className="p-2">{DAY_NAMES[d]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: maxPeriod }, (_, i) => i + 1).map((n) => (
                  <tr key={n} className="border-t border-border">
                    <td className="p-2 text-center font-bold text-muted">{n}</td>
                    {days.map((d) => {
                      const p = at(d, n);
                      return (
                        <td key={d} className="border-s border-border p-1 align-top">
                          {p ? (
                            <Link href={`#edit-${p.id}`} className="block rounded-lg bg-primary-soft p-2 hover:ring-2 hover:ring-primary/40">
                              <span className="block font-medium text-primary">{names.get(p.classroom_id) ?? "—"}</span>
                              {p.subject && <span className="block text-xs text-muted">{p.subject}</span>}
                              {p.start_time && <span className="block text-xs text-muted ltr-nums">{formatTime(p.start_time)}–{formatTime(p.end_time)}</span>}
                            </Link>
                          ) : (
                            <span className="block h-12" />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <PeriodEditor periods={ps} classrooms={classrooms} />
        </>
      )}
    </>
  );
}
